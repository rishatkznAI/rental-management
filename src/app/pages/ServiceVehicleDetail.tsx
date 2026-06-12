import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Car, Plus, Trash2, Edit2, Save, X,
  AlertTriangle, CheckCircle, FileText, History,
  MapPin, User, Calendar, Gauge, Wrench, Ban,
} from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';
import {
  useServiceVehicleById,
  useCreateVehicle,
  useUpdateVehicle,
  useDeleteVehicle,
  useVehicleTrips,
  useCreateTrip,
  useUpdateTrip,
  useDeleteTrip,
} from '../hooks/useServiceVehicles';
import type { ServiceVehicle, VehicleStatus, VehicleType, VehicleTrip } from '../types';
import type { CreateVehiclePayload, CreateTripPayload } from '../services/service-vehicles.service';

// ── Labels ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<VehicleStatus, string> = {
  active:      'В работе',
  repair:      'На ремонте',
  unavailable: 'Недоступна',
  reserve:     'Резерв',
};

const TYPE_LABELS: Record<VehicleType, string> = {
  car:     'Легковой',
  van:     'Фургон',
  truck:   'Грузовой',
  minibus: 'Микроавтобус',
  other:   'Другой',
};

const TRIP_STATUS_LABELS: Record<NonNullable<VehicleTrip['status']>, string> = {
  draft: 'Черновик',
  issued: 'Выдан',
  in_progress: 'В рейсе',
  completed: 'Закрыт',
  cancelled: 'Отменён',
};

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

function statusVariant(s: VehicleStatus): BadgeVariant {
  const map: Record<VehicleStatus, BadgeVariant> = {
    active: 'success', repair: 'error', unavailable: 'warning', reserve: 'default',
  };
  return map[s] ?? 'default';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isExpired(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

function isExpiringSoon(dateStr: string | null, daysAhead = 30): boolean {
  if (!dateStr) return false;
  const diff = (new Date(dateStr).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= daysAhead;
}

function DateField({
  label, value, onChange, readOnly, warn, error,
}: {
  label: string; value: string; onChange: (v: string) => void;
  readOnly?: boolean; warn?: boolean; error?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        className={cn(
          'block w-full h-9 rounded-md border px-3 text-sm',
          'bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
          'focus:outline-none focus:ring-2 focus:ring-blue-500',
          error  && 'border-red-500',
          warn   && 'border-amber-400',
          !error && !warn && 'border-gray-200 dark:border-gray-700',
          readOnly && 'cursor-default opacity-70',
        )}
      />
      {(warn || error) && value && (
        <p className={cn('text-xs', error ? 'text-red-500' : 'text-amber-500')}>
          {error ? 'Срок истёк' : 'Скоро истекает'}
        </p>
      )}
    </div>
  );
}

// ── Blank form ────────────────────────────────────────────────────────────────

function blankVehicle(): CreateVehiclePayload {
  return {
    make: '', model: '', plateNumber: '', vin: null,
    year: null, vehicleType: 'car', color: null,
    currentMileage: 0, mileageUpdatedAt: null,
    responsiblePerson: '', conditionNote: '', status: 'active',
    osagoExpiresAt: null, insuranceExpiresAt: null,
    nextServiceAt: null, serviceNote: null,
  };
}

function blankTrip(vehicleId: string, currentMileage: number): CreateTripPayload {
  return {
    vehicleId,
    sheetNumber: '',
    date: new Date().toISOString().slice(0, 10),
    driver: '',
    driverName: '',
    driverId: null,
    mechanicId: null,
    serviceRequestId: null,
    route: '',
    routeFrom: '',
    routeTo: '',
    purpose: '',
    startMileage: currentMileage,
    endMileage: null,
    odometerStart: currentMileage,
    odometerEnd: null,
    fuelStart: null,
    fuelAdded: null,
    fuelEnd: null,
    status: 'draft',
    startedAt: null,
    completedAt: null,
    serviceTicketId: null, clientId: null, comment: '',
  };
}

function tripFormFromTrip(trip: VehicleTrip): CreateTripPayload {
  return {
    vehicleId: trip.vehicleId,
    sheetNumber: trip.sheetNumber || '',
    date: trip.date,
    driver: trip.driverName || trip.driver || '',
    driverName: trip.driverName || trip.driver || '',
    driverId: trip.driverId || null,
    mechanicId: trip.mechanicId || null,
    serviceRequestId: trip.serviceRequestId || trip.serviceTicketId || null,
    route: trip.route || '',
    routeFrom: trip.routeFrom || '',
    routeTo: trip.routeTo || '',
    purpose: trip.purpose || '',
    startMileage: trip.odometerStart ?? trip.startMileage ?? 0,
    endMileage: trip.odometerEnd ?? trip.endMileage ?? null,
    odometerStart: trip.odometerStart ?? trip.startMileage ?? 0,
    odometerEnd: trip.odometerEnd ?? trip.endMileage ?? null,
    fuelStart: trip.fuelStart ?? null,
    fuelAdded: trip.fuelAdded ?? null,
    fuelEnd: trip.fuelEnd ?? null,
    status: trip.status || 'draft',
    startedAt: trip.startedAt || null,
    completedAt: trip.completedAt || null,
    serviceTicketId: trip.serviceTicketId || trip.serviceRequestId || null,
    clientId: trip.clientId || null,
    comment: trip.comment || '',
  };
}

// ── Main component ────────────────────────────────────────────────────────────

type TabKey = 'info' | 'trips';

export default function ServiceVehicleDetail() {
  const { id }       = useParams<{ id: string }>();
  const navigate     = useNavigate();
  const { can }      = usePermissions();
  const { user }     = useAuth();
  const canEdit      = can('edit',   'service_vehicles');
  const canDelete    = can('delete', 'service_vehicles');
  const isNew        = id === 'new';

  const [tab, setTab] = useState<TabKey>('info');

  const { data: vehicle, isLoading } = useServiceVehicleById(id ?? '');
  const { data: trips = [] }         = useVehicleTrips(isNew ? '' : (id ?? ''));

  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const createTrip    = useCreateTrip();
  const updateTrip    = useUpdateTrip();
  const deleteTrip    = useDeleteTrip();

  // Form state
  const [editing, setEditing] = useState(isNew);
  const [form, setForm]       = useState<CreateVehiclePayload>(blankVehicle());
  const [formError, setFormError] = useState('');

  // Trip form
  const [tripOpen,  setTripOpen]  = useState(false);
  const [editingTrip, setEditingTrip] = useState<VehicleTrip | null>(null);
  const [tripForm,  setTripForm]  = useState<CreateTripPayload>(blankTrip('', 0));
  const [tripError, setTripError] = useState('');

  useEffect(() => {
    if (vehicle) {
      setForm({
        make: vehicle.make, model: vehicle.model, plateNumber: vehicle.plateNumber,
        vin: vehicle.vin, year: vehicle.year, vehicleType: vehicle.vehicleType,
        color: vehicle.color, currentMileage: vehicle.currentMileage,
        mileageUpdatedAt: vehicle.mileageUpdatedAt,
        responsiblePerson: vehicle.responsiblePerson,
        conditionNote: vehicle.conditionNote, status: vehicle.status,
        osagoExpiresAt: vehicle.osagoExpiresAt,
        insuranceExpiresAt: vehicle.insuranceExpiresAt,
        nextServiceAt: vehicle.nextServiceAt, serviceNote: vehicle.serviceNote,
      });
    }
  }, [vehicle]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function setF<K extends keyof CreateVehiclePayload>(key: K, value: CreateVehiclePayload[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setFormError('');
    if (!form.make.trim())        return setFormError('Введите марку');
    if (!form.model.trim())       return setFormError('Введите модель');
    if (!form.plateNumber.trim()) return setFormError('Введите госномер');

    try {
      if (isNew) {
        const created = await createVehicle.mutateAsync(form);
        navigate(`/service-vehicles/${created.id}`, { replace: true });
      } else {
        await updateVehicle.mutateAsync({ id: id!, payload: form });
        setEditing(false);
      }
    } catch (e: any) {
      setFormError(e?.message ?? 'Ошибка сохранения');
    }
  }

  async function handleDelete() {
    if (!confirm('Удалить машину? Данные поездок останутся в базе.')) return;
    await deleteVehicle.mutateAsync(id!);
    navigate('/service-vehicles');
  }

  function openTripForm() {
    setEditingTrip(null);
    setTripForm(blankTrip(id!, vehicle?.currentMileage ?? 0));
    setTripError('');
    setTripOpen(true);
  }

  function openEditTrip(trip: VehicleTrip) {
    setEditingTrip(trip);
    setTripForm(tripFormFromTrip(trip));
    setTripError('');
    setTripOpen(true);
  }

  async function handleSaveTrip() {
    setTripError('');
    const driverName = String(tripForm.driverName || tripForm.driver || '').trim();
    const route = [tripForm.routeFrom, tripForm.routeTo].filter(Boolean).join(' — ') || String(tripForm.route || '').trim();
    const odometerStart = Number(tripForm.odometerStart ?? tripForm.startMileage);
    const odometerEnd = tripForm.odometerEnd === null || tripForm.odometerEnd === undefined
      ? null
      : Number(tripForm.odometerEnd);
    if (!driverName) return setTripError('Введите водителя');
    if (!route)  return setTripError('Введите маршрут');
    if (tripForm.status === 'completed' && (odometerEnd === null || !Number.isFinite(odometerStart))) {
      return setTripError('Для закрытия заполните начальный и конечный пробег');
    }
    if (odometerEnd !== null && odometerEnd < odometerStart)
      return setTripError('Конечный пробег не может быть меньше начального');

    try {
      const payload = {
        ...tripForm,
        driver: driverName,
        driverName,
        route,
        startMileage: odometerStart,
        endMileage: odometerEnd,
        odometerStart,
        odometerEnd,
        serviceTicketId: tripForm.serviceRequestId || tripForm.serviceTicketId || null,
      };
      if (editingTrip) {
        await updateTrip.mutateAsync({ id: editingTrip.id, vehicleId: editingTrip.vehicleId, payload });
      } else {
        await createTrip.mutateAsync(payload);
      }
      setTripOpen(false);
      setEditingTrip(null);
    } catch (e: any) {
      setTripError(e?.message ?? 'Ошибка сохранения');
    }
  }

  async function updateTripStatus(trip: VehicleTrip, status: NonNullable<VehicleTrip['status']>) {
    setTripError('');
    try {
      await updateTrip.mutateAsync({
        id: trip.id,
        vehicleId: trip.vehicleId,
        payload: {
          status,
          completedAt: status === 'completed' ? new Date().toISOString() : trip.completedAt,
        },
      });
    } catch (e: any) {
      setTripError(e?.message ?? 'Ошибка обновления путевого листа');
      openEditTrip(trip);
    }
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm('Удалить запись поездки?')) return;
    await deleteTrip.mutateAsync({ id: tripId, vehicleId: id! });
  }

  // ── Waybill stub ────────────────────────────────────────────────────────────

  function handleWaybill(trip: VehicleTrip) {
    const distance = trip.distanceKm ?? trip.distance ?? 0;
    const route = trip.route || [trip.routeFrom, trip.routeTo].filter(Boolean).join(' — ');
    alert(
      `Путевой лист (заготовка)\n\n` +
      `Машина: ${vehicle?.make} ${vehicle?.model} (${vehicle?.plateNumber})\n` +
      `Номер: ${trip.sheetNumber || trip.id}\n` +
      `Дата: ${trip.date}\n` +
      `Водитель: ${trip.driverName || trip.driver}\n` +
      `Маршрут: ${route}\n` +
      `Цель: ${trip.purpose || '—'}\n` +
      `Пробег: ${trip.odometerStart ?? trip.startMileage} → ${trip.odometerEnd ?? trip.endMileage ?? '—'} км (${distance} км)\n` +
      (trip.serviceRequestId || trip.serviceTicketId ? `Заявка: ${trip.serviceRequestId || trip.serviceTicketId}\n` : '') +
      `\n⚠ Полноценная генерация PDF будет добавлена в следующей версии.`,
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        Загрузка…
      </div>
    );
  }

  if (!isNew && !vehicle) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Машина не найдена
      </div>
    );
  }

  const displayVehicle = vehicle ?? form as unknown as ServiceVehicle;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthTrips = trips.filter(trip => String(trip.date || '').startsWith(currentMonth));
  const completedTrips = trips.filter(trip => (trip.status || 'completed') === 'completed');
  const monthDistance = monthTrips.reduce((sum, trip) => sum + (trip.distanceKm ?? trip.distance ?? 0), 0);
  const totalDistance = trips.reduce((sum, trip) => sum + (trip.distanceKm ?? trip.distance ?? 0), 0);
  const lastClosedTrip = completedTrips
    .slice()
    .sort((a, b) => String(b.completedAt || b.date || '').localeCompare(String(a.completedAt || a.date || '')))[0];
  const lastDriver = trips[0]?.driverName || trips[0]?.driver || '—';
  const lastMileage = lastClosedTrip?.odometerEnd ?? lastClosedTrip?.endMileage ?? vehicle?.currentMileage ?? 0;
  const tripsWithFuel = trips.filter(trip => Number.isFinite(Number(trip.fuelConsumption)) && (trip.distanceKm ?? trip.distance ?? 0) > 0);
  const avgFuel = tripsWithFuel.length > 0
    ? tripsWithFuel.reduce((sum, trip) => {
      const distance = trip.distanceKm ?? trip.distance ?? 0;
      return sum + ((Number(trip.fuelConsumption) / distance) * 100);
    }, 0) / tripsWithFuel.length
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/service-vehicles')}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
            {isNew
              ? 'Новая машина'
              : `${displayVehicle.make} ${displayVehicle.model} · ${displayVehicle.plateNumber}`}
          </h1>
          {!isNew && vehicle && (
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={statusVariant(vehicle.status)}>{STATUS_LABELS[vehicle.status]}</Badge>
              <span className="text-xs text-gray-400">{TYPE_LABELS[vehicle.vehicleType]}</span>
            </div>
          )}
        </div>
        {!isNew && canEdit && !editing && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Edit2 className="h-3.5 w-3.5 mr-1" /> Редактировать
            </Button>
            {canDelete && (
              <Button variant="outline" size="sm"
                className="text-red-500 hover:text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        {(isNew || editing) && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave}
              disabled={createVehicle.isPending || updateVehicle.isPending}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {isNew ? 'Создать' : 'Сохранить'}
            </Button>
            {!isNew && (
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setFormError(''); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {formError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {formError}
        </div>
      )}

      {/* Tabs (only for existing) */}
      {!isNew && (
        <div className="flex border-b border-gray-200 dark:border-gray-700 gap-1">
          {([['info', 'Карточка', Car], ['trips', 'Путевые листы', History]] as const).map(
            ([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  tab === key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {key === 'trips' && trips.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs">
                    {trips.length}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}

      {/* ── Tab: Info ── */}
      {(isNew || tab === 'info') && (
        <div className="space-y-4">
          {/* Основные данные */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="h-4 w-4 text-blue-500" /> Основные данные
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Марка *" value={form.make} onChange={v => setF('make', v)} readOnly={!editing} />
                <Field label="Модель *" value={form.model} onChange={v => setF('model', v)} readOnly={!editing} />
                <Field
                  label="Госномер *"
                  value={form.plateNumber}
                  onChange={v => setF('plateNumber', v.toUpperCase())}
                  readOnly={!editing}
                  mono
                />
                <Field label="VIN" value={form.vin ?? ''} onChange={v => setF('vin', v || null)} readOnly={!editing} mono />
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Тип ТС</label>
                  {editing ? (
                    <select
                      value={form.vehicleType}
                      onChange={e => setF('vehicleType', e.target.value as VehicleType)}
                      className="block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {(Object.keys(TYPE_LABELS) as VehicleType[]).map(t => (
                        <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="h-9 flex items-center text-sm text-gray-900 dark:text-white px-3 rounded-md bg-gray-50 dark:bg-gray-700/30">
                      {TYPE_LABELS[form.vehicleType]}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Год выпуска</label>
                  <input
                    type="number"
                    value={form.year ?? ''}
                    onChange={e => setF('year', e.target.value ? Number(e.target.value) : null)}
                    readOnly={!editing}
                    min={1980} max={new Date().getFullYear()}
                    className="block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:opacity-70 read-only:cursor-default"
                  />
                </div>
                <Field label="Цвет" value={form.color ?? ''} onChange={v => setF('color', v || null)} readOnly={!editing} />
              </div>
            </CardContent>
          </Card>

          {/* Эксплуатация */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4 text-blue-500" /> Эксплуатация
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Текущий пробег (км)</label>
                  <input
                    type="number"
                    value={form.currentMileage}
                    onChange={e => setF('currentMileage', Math.max(0, Number(e.target.value)))}
                    readOnly={!editing}
                    min={0}
                    className="block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:opacity-70 read-only:cursor-default"
                  />
                </div>
                <DateField
                  label="Дата обновления пробега"
                  value={form.mileageUpdatedAt ?? ''}
                  onChange={v => setF('mileageUpdatedAt', v || null)}
                  readOnly={!editing}
                />
                <Field
                  label="Ответственное лицо"
                  value={form.responsiblePerson}
                  onChange={v => setF('responsiblePerson', v)}
                  readOnly={!editing}
                />
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Статус</label>
                  {editing ? (
                    <select
                      value={form.status}
                      onChange={e => setF('status', e.target.value as VehicleStatus)}
                      className="block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map(s => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="h-9 flex items-center px-3 rounded-md bg-gray-50 dark:bg-gray-700/30">
                      <Badge variant={statusVariant(form.status as VehicleStatus)}>
                        {STATUS_LABELS[form.status as VehicleStatus]}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Комментарий по состоянию</label>
                  {editing ? (
                    <textarea
                      value={form.conditionNote}
                      onChange={e => setF('conditionNote', e.target.value)}
                      rows={2}
                      className="block w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  ) : (
                    <div className="min-h-[2.5rem] text-sm text-gray-700 dark:text-gray-300 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-700/30">
                      {form.conditionNote || '—'}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Документы и ТО */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> Документы и обслуживание
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <DateField
                  label="ОСАГО до"
                  value={form.osagoExpiresAt ?? ''}
                  onChange={v => setF('osagoExpiresAt', v || null)}
                  readOnly={!editing}
                  error={isExpired(form.osagoExpiresAt)}
                  warn={isExpiringSoon(form.osagoExpiresAt)}
                />
                <DateField
                  label="Страховка до"
                  value={form.insuranceExpiresAt ?? ''}
                  onChange={v => setF('insuranceExpiresAt', v || null)}
                  readOnly={!editing}
                  error={isExpired(form.insuranceExpiresAt)}
                  warn={isExpiringSoon(form.insuranceExpiresAt)}
                />
                <DateField
                  label="Следующее ТО"
                  value={form.nextServiceAt ?? ''}
                  onChange={v => setF('nextServiceAt', v || null)}
                  readOnly={!editing}
                  warn={isExpiringSoon(form.nextServiceAt, 14)}
                />
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Примечание</label>
                  {editing ? (
                    <textarea
                      value={form.serviceNote ?? ''}
                      onChange={e => setF('serviceNote', e.target.value || null)}
                      rows={2}
                      className="block w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  ) : (
                    <div className="min-h-[2.5rem] text-sm text-gray-700 dark:text-gray-300 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-700/30">
                      {form.serviceNote || '—'}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tab: Trips ── */}
      {!isNew && tab === 'trips' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Путевые листы</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Выезды, пробег, топливо и связанные сервисные задачи.</p>
            </div>
            {canEdit && (
              <Button size="sm" onClick={openTripForm}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Создать путевой лист
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <TripKpi title="Листов за месяц" value={monthTrips.length} />
            <TripKpi title="Пробег за месяц" value={`${monthDistance.toLocaleString('ru-RU')} км`} />
            <TripKpi title="Средний расход" value={avgFuel === null ? '—' : `${avgFuel.toFixed(1)} л/100 км`} />
            <TripKpi title="Последний пробег" value={`${Number(lastMileage || 0).toLocaleString('ru-RU')} км`} />
            <TripKpi title="Последний водитель" value={lastDriver} />
          </div>

          {tripError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />{tripError}
            </div>
          )}

          {trips.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-400 dark:text-gray-500">
              <History className="h-10 w-10 mb-2 opacity-40" />
              <p>Путевых листов пока нет</p>
            </div>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {trips.map(trip => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  canEdit={canEdit}
                  onEdit={() => openEditTrip(trip)}
                  onClose={() => updateTripStatus(trip, 'completed')}
                  onCancel={() => updateTripStatus(trip, 'cancelled')}
                  onDelete={() => handleDeleteTrip(trip.id)}
                  onWaybill={() => handleWaybill(trip)}
                />
              ))}
            </div>

            <div className="hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер / дата</TableHead>
                    <TableHead>Водитель</TableHead>
                    <TableHead>Маршрут</TableHead>
                    <TableHead>Цель</TableHead>
                    <TableHead>Пробег</TableHead>
                    <TableHead>Топливо</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-[150px]">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.map(trip => (
                    <TripRow
                      key={trip.id}
                      trip={trip}
                      canEdit={canEdit}
                      onEdit={() => openEditTrip(trip)}
                      onClose={() => updateTripStatus(trip, 'completed')}
                      onCancel={() => updateTripStatus(trip, 'cancelled')}
                      onDelete={() => handleDeleteTrip(trip.id)}
                      onWaybill={() => handleWaybill(trip)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}

          <p className="text-xs text-gray-400">Итого по машине: {trips.length} листов · {totalDistance.toLocaleString('ru-RU')} км</p>
        </div>
      )}

      <Dialog open={tripOpen} onOpenChange={(open) => { setTripOpen(open); if (!open) setEditingTrip(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingTrip ? 'Редактировать путевой лист' : 'Создать путевой лист'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TripField label="Дата выезда" type="date" value={tripForm.date} onChange={v => setTripForm(p => ({ ...p, date: v }))} />
            <TripField label="Номер путевого листа" value={tripForm.sheetNumber || ''} onChange={v => setTripForm(p => ({ ...p, sheetNumber: v }))} />
            <TripField label="Водитель / механик *" value={tripForm.driverName || tripForm.driver || ''} onChange={v => setTripForm(p => ({ ...p, driver: v, driverName: v }))} />
            <TripField label="ID механика" value={tripForm.mechanicId || ''} onChange={v => setTripForm(p => ({ ...p, mechanicId: v || null }))} />
            <TripField label="Связанная сервисная заявка" value={tripForm.serviceRequestId || tripForm.serviceTicketId || ''} onChange={v => setTripForm(p => ({ ...p, serviceRequestId: v || null, serviceTicketId: v || null }))} />
            <Select value={tripForm.status || 'draft'} onValueChange={value => setTripForm(p => ({ ...p, status: value as NonNullable<VehicleTrip['status']> }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TRIP_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <TripField label="Откуда" value={tripForm.routeFrom || ''} onChange={v => setTripForm(p => ({ ...p, routeFrom: v }))} />
            <TripField label="Куда" value={tripForm.routeTo || ''} onChange={v => setTripForm(p => ({ ...p, routeTo: v }))} />
            <TripField label="Цель поездки" value={tripForm.purpose || ''} onChange={v => setTripForm(p => ({ ...p, purpose: v }))} />
            <TripField label="Пробег на начало" type="number" value={String(tripForm.odometerStart ?? tripForm.startMileage ?? 0)} onChange={v => setTripForm(p => ({ ...p, odometerStart: Math.max(0, Number(v)), startMileage: Math.max(0, Number(v)) }))} />
            <TripField label="Пробег на конец" type="number" value={tripForm.odometerEnd === null || tripForm.odometerEnd === undefined ? '' : String(tripForm.odometerEnd)} onChange={v => setTripForm(p => ({ ...p, odometerEnd: v === '' ? null : Math.max(0, Number(v)), endMileage: v === '' ? null : Math.max(0, Number(v)) }))} />
            <div className="flex items-end pb-2 text-sm text-gray-500 dark:text-gray-400">
              Пробег: {Math.max(0, Number(tripForm.odometerEnd ?? tripForm.endMileage ?? tripForm.odometerStart ?? tripForm.startMileage ?? 0) - Number(tripForm.odometerStart ?? tripForm.startMileage ?? 0)).toLocaleString('ru-RU')} км
            </div>
            <TripField label="Топливо на начало" type="number" value={tripForm.fuelStart === null || tripForm.fuelStart === undefined ? '' : String(tripForm.fuelStart)} onChange={v => setTripForm(p => ({ ...p, fuelStart: v === '' ? null : Math.max(0, Number(v)) }))} />
            <TripField label="Долив топлива" type="number" value={tripForm.fuelAdded === null || tripForm.fuelAdded === undefined ? '' : String(tripForm.fuelAdded)} onChange={v => setTripForm(p => ({ ...p, fuelAdded: v === '' ? null : Math.max(0, Number(v)) }))} />
            <TripField label="Топливо на конец" type="number" value={tripForm.fuelEnd === null || tripForm.fuelEnd === undefined ? '' : String(tripForm.fuelEnd)} onChange={v => setTripForm(p => ({ ...p, fuelEnd: v === '' ? null : Math.max(0, Number(v)) }))} />
            <div className="flex items-end pb-2 text-sm text-gray-500 dark:text-gray-400">
              Расход: {tripForm.fuelStart !== null && tripForm.fuelStart !== undefined && tripForm.fuelAdded !== null && tripForm.fuelAdded !== undefined && tripForm.fuelEnd !== null && tripForm.fuelEnd !== undefined
                ? `${Math.max(0, Number(tripForm.fuelStart) + Number(tripForm.fuelAdded) - Number(tripForm.fuelEnd)).toLocaleString('ru-RU')} л`
                : '—'}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Комментарий</label>
              <Textarea value={tripForm.comment || ''} onChange={e => setTripForm(p => ({ ...p, comment: e.target.value }))} rows={3} />
            </div>
          </div>
          {tripError && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />{tripError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTripOpen(false); setEditingTrip(null); }}>Отмена</Button>
            <Button onClick={handleSaveTrip} disabled={createTrip.isPending || updateTrip.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function Field({
  label, value, onChange, readOnly, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  readOnly?: boolean; mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        className={cn(
          'block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white',
          'focus:outline-none focus:ring-2 focus:ring-blue-500',
          readOnly && 'opacity-70 cursor-default',
          mono && 'font-mono',
        )}
      />
    </div>
  );
}

function TripField({
  label, value, onChange, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="block w-full h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function TripKpi({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="truncate text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
      </CardContent>
    </Card>
  );
}

function tripStatusVariant(status: NonNullable<VehicleTrip['status']> | undefined): BadgeVariant {
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'default';
  if (status === 'in_progress') return 'info';
  if (status === 'issued') return 'warning';
  return 'default';
}

function TripRow({
  trip, canEdit, onDelete, onWaybill, onEdit, onClose, onCancel,
}: {
  trip: VehicleTrip;
  canEdit: boolean;
  onDelete: () => void;
  onWaybill: () => void;
  onEdit: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const status = trip.status || 'completed';
  const distance = trip.distanceKm ?? trip.distance ?? 0;
  const fuel = trip.fuelConsumption;
  const route = trip.route || [trip.routeFrom, trip.routeTo].filter(Boolean).join(' — ');
  return (
    <TableRow>
      <TableCell>
        <div className="min-w-28">
          <p className="font-medium text-gray-900 dark:text-white">{trip.sheetNumber || trip.id}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Calendar className="h-3 w-3" />{formatDate(trip.date)}</p>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <User className="h-3.5 w-3.5 text-gray-400" />
          {trip.driverName || trip.driver}
        </div>
      </TableCell>
      <TableCell>
        <div className="max-w-[220px] truncate" title={route}>
          <MapPin className="mr-1 inline h-3.5 w-3.5 text-gray-400" />
          {route}
        </div>
        {(trip.serviceRequestId || trip.serviceTicketId) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
            <Wrench className="h-3 w-3" />
            {trip.serviceRequestId || trip.serviceTicketId}
          </p>
        )}
      </TableCell>
      <TableCell>
        <p className="max-w-[180px] truncate" title={trip.purpose || ''}>{trip.purpose || '—'}</p>
        {trip.comment && <p className="mt-1 max-w-[180px] truncate text-xs text-gray-400">{trip.comment}</p>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5 text-gray-400" />
          {distance.toLocaleString('ru-RU')} км
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {Number(trip.odometerStart ?? trip.startMileage ?? 0).toLocaleString('ru-RU')} → {trip.odometerEnd ?? trip.endMileage ?? '—'}
        </p>
      </TableCell>
      <TableCell>{fuel === null || fuel === undefined ? '—' : `${Number(fuel).toLocaleString('ru-RU')} л`}</TableCell>
      <TableCell><Badge variant={tripStatusVariant(status)}>{TRIP_STATUS_LABELS[status]}</Badge></TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <button
            onClick={onWaybill}
            title="Путевой лист"
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-500 transition-colors"
          >
            <FileText className="h-4 w-4" />
          </button>
          {canEdit && (
            <>
            <button
              onClick={onEdit}
              title="Редактировать"
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-500 transition-colors"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            {status !== 'completed' && status !== 'cancelled' && (
              <button
                onClick={onClose}
                title="Закрыть путевой лист"
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-emerald-500 transition-colors"
              >
                <CheckCircle className="h-4 w-4" />
              </button>
            )}
            {status !== 'cancelled' && (
              <button
                onClick={onCancel}
                title="Отменить"
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-amber-500 transition-colors"
              >
                <Ban className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onDelete}
              title="Удалить"
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function TripCard({
  trip, canEdit, onDelete, onWaybill, onEdit, onClose, onCancel,
}: {
  trip: VehicleTrip;
  canEdit: boolean;
  onDelete: () => void;
  onWaybill: () => void;
  onEdit: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const status = trip.status || 'completed';
  const distance = trip.distanceKm ?? trip.distance ?? 0;
  const fuel = trip.fuelConsumption;
  const route = trip.route || [trip.routeFrom, trip.routeTo].filter(Boolean).join(' — ');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900 dark:text-white">{trip.sheetNumber || trip.id}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatDate(trip.date)}
          </div>
        </div>
        <Badge variant={tripStatusVariant(status)}>{TRIP_STATUS_LABELS[status]}</Badge>
      </div>

      <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
        <TripCardLine icon={User} label="Водитель" value={trip.driverName || trip.driver || '—'} />
        <TripCardLine icon={MapPin} label="Маршрут" value={route || '—'} />
        {(trip.serviceRequestId || trip.serviceTicketId) && (
          <TripCardLine icon={Wrench} label="Заявка" value={trip.serviceRequestId || trip.serviceTicketId || '—'} />
        )}
        <TripCardLine icon={Gauge} label="Пробег" value={`${distance.toLocaleString('ru-RU')} км`} />
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
          <TripCardMetric label="Одометр" value={`${Number(trip.odometerStart ?? trip.startMileage ?? 0).toLocaleString('ru-RU')} → ${trip.odometerEnd ?? trip.endMileage ?? '—'}`} />
          <TripCardMetric label="Топливо" value={fuel === null || fuel === undefined ? '—' : `${Number(fuel).toLocaleString('ru-RU')} л`} />
        </div>
        {(trip.purpose || trip.comment) && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
            {trip.purpose || '—'}
            {trip.comment && <div className="mt-1 text-gray-400">{trip.comment}</div>}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-gray-100 pt-3 dark:border-gray-700">
        <TripActionButton label="Путевой лист" onClick={onWaybill} icon={FileText} />
        {canEdit && (
          <>
            <TripActionButton label="Редактировать" onClick={onEdit} icon={Edit2} />
            {status !== 'completed' && status !== 'cancelled' && (
              <TripActionButton label="Закрыть путевой лист" onClick={onClose} icon={CheckCircle} tone="success" />
            )}
            {status !== 'cancelled' && (
              <TripActionButton label="Отменить" onClick={onCancel} icon={Ban} tone="warning" />
            )}
            <TripActionButton label="Удалить" onClick={onDelete} icon={Trash2} tone="danger" />
          </>
        )}
      </div>
    </div>
  );
}

function TripCardLine({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}: </span>
        <span className="break-words">{value}</span>
      </div>
    </div>
  );
}

function TripCardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase text-gray-400">{label}</div>
      <div className="mt-0.5 truncate text-gray-700 dark:text-gray-200">{value}</div>
    </div>
  );
}

function TripActionButton({
  label,
  onClick,
  icon: Icon,
  tone,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-700',
        tone === 'success' && 'hover:text-emerald-500',
        tone === 'warning' && 'hover:text-amber-500',
        tone === 'danger' && 'hover:text-red-500',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
