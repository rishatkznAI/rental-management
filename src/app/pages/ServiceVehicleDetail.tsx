import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, Car, Plus, Trash2, Edit2, Save, X,
  AlertTriangle, CheckCircle, FileText, History,
  MapPin, User, Calendar, Gauge, Wrench,
} from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  useServiceVehicleById,
  useCreateVehicle,
  useUpdateVehicle,
  useDeleteVehicle,
  useVehicleTrips,
  useCreateTrip,
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
    date: new Date().toISOString().slice(0, 10),
    driver: '', route: '', purpose: '',
    startMileage: currentMileage,
    endMileage: currentMileage,
    serviceTicketId: null, clientId: null, comment: '',
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
  const deleteTrip    = useDeleteTrip();

  // Form state
  const [editing, setEditing] = useState(isNew);
  const [form, setForm]       = useState<CreateVehiclePayload>(blankVehicle());
  const [formError, setFormError] = useState('');

  // Trip form
  const [tripOpen,  setTripOpen]  = useState(false);
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
    setTripForm(blankTrip(id!, vehicle?.currentMileage ?? 0));
    setTripError('');
    setTripOpen(true);
  }

  async function handleSaveTrip() {
    setTripError('');
    if (!tripForm.driver.trim()) return setTripError('Введите водителя');
    if (!tripForm.route.trim())  return setTripError('Введите маршрут');
    if (tripForm.endMileage < tripForm.startMileage)
      return setTripError('Конечный пробег не может быть меньше начального');

    try {
      await createTrip.mutateAsync(tripForm);
      setTripOpen(false);
    } catch (e: any) {
      setTripError(e?.message ?? 'Ошибка сохранения');
    }
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm('Удалить запись поездки?')) return;
    await deleteTrip.mutateAsync({ id: tripId, vehicleId: id! });
  }

  // ── Waybill stub ────────────────────────────────────────────────────────────

  function handleWaybill(trip: VehicleTrip) {
    alert(
      `Путевой лист (заготовка)\n\n` +
      `Машина: ${vehicle?.make} ${vehicle?.model} (${vehicle?.plateNumber})\n` +
      `Дата: ${trip.date}\n` +
      `Водитель: ${trip.driver}\n` +
      `Маршрут: ${trip.route}\n` +
      `Цель: ${trip.purpose || '—'}\n` +
      `Пробег: ${trip.startMileage} → ${trip.endMileage} км (${trip.distance} км)\n` +
      (trip.serviceTicketId ? `Заявка: ${trip.serviceTicketId}\n` : '') +
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
          {([['info', 'Карточка', Car], ['trips', 'Журнал поездок', History]] as const).map(
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Итого поездок: <span className="font-medium text-gray-800 dark:text-gray-200">{trips.length}</span>
              {trips.length > 0 && (
                <> · Общий пробег: <span className="font-medium text-gray-800 dark:text-gray-200">
                  {trips.reduce((s, t) => s + t.distance, 0).toLocaleString('ru-RU')} км
                </span></>
              )}
            </p>
            {canEdit && (
              <Button size="sm" onClick={openTripForm}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить поездку
              </Button>
            )}
          </div>

          {/* Trip form */}
          {tripOpen && (
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Новая поездка</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TripField label="Дата" type="date"
                    value={tripForm.date}
                    onChange={v => setTripForm(p => ({ ...p, date: v }))}
                  />
                  <TripField label="Водитель *"
                    value={tripForm.driver}
                    onChange={v => setTripForm(p => ({ ...p, driver: v }))}
                  />
                  <TripField label="Маршрут *"
                    value={tripForm.route}
                    onChange={v => setTripForm(p => ({ ...p, route: v }))}
                  />
                  <TripField label="Цель поездки"
                    value={tripForm.purpose}
                    onChange={v => setTripForm(p => ({ ...p, purpose: v }))}
                  />
                  <TripField label="Начальный пробег (км)" type="number"
                    value={String(tripForm.startMileage)}
                    onChange={v => setTripForm(p => ({ ...p, startMileage: Math.max(0, Number(v)) }))}
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      Конечный пробег (км)
                    </label>
                    <input
                      type="number"
                      value={tripForm.endMileage}
                      onChange={e => setTripForm(p => ({ ...p, endMileage: Math.max(0, Number(e.target.value)) }))}
                      min={tripForm.startMileage}
                      className={cn(
                        'block w-full h-9 rounded-md border px-3 text-sm',
                        'bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500',
                        tripForm.endMileage < tripForm.startMileage
                          ? 'border-red-500' : 'border-gray-200 dark:border-gray-700',
                      )}
                    />
                    <p className="text-xs text-gray-400">
                      Пробег за поездку: <span className="font-medium">
                        {Math.max(0, tripForm.endMileage - tripForm.startMileage).toLocaleString('ru-RU')} км
                      </span>
                    </p>
                  </div>
                  <TripField label="Связанная заявка (ID)"
                    value={tripForm.serviceTicketId ?? ''}
                    onChange={v => setTripForm(p => ({ ...p, serviceTicketId: v || null }))}
                  />
                  <TripField label="Клиент / объект"
                    value={tripForm.clientId ?? ''}
                    onChange={v => setTripForm(p => ({ ...p, clientId: v || null }))}
                  />
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Комментарий</label>
                    <textarea
                      value={tripForm.comment}
                      onChange={e => setTripForm(p => ({ ...p, comment: e.target.value }))}
                      rows={2}
                      className="block w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>

                {tripError && (
                  <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />{tripError}
                  </p>
                )}

                <div className="flex gap-2 mt-4">
                  <Button size="sm" onClick={handleSaveTrip} disabled={createTrip.isPending}>
                    <Save className="h-3.5 w-3.5 mr-1" /> Сохранить
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setTripOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trips list */}
          {trips.length === 0 && !tripOpen ? (
            <div className="flex flex-col items-center py-12 text-gray-400 dark:text-gray-500">
              <History className="h-10 w-10 mb-2 opacity-40" />
              <p>Поездок пока нет</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trips.map(trip => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  canEdit={canEdit}
                  onDelete={() => handleDeleteTrip(trip.id)}
                  onWaybill={() => handleWaybill(trip)}
                />
              ))}
            </div>
          )}
        </div>
      )}
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

function TripCard({
  trip, canEdit, onDelete, onWaybill,
}: {
  trip: VehicleTrip;
  canEdit: boolean;
  onDelete: () => void;
  onWaybill: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-900 dark:text-white">
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
              {trip.date}
            </span>
            <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
              <User className="h-3.5 w-3.5 text-gray-400" />
              {trip.driver}
            </span>
            <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
              <Gauge className="h-3.5 w-3.5 text-gray-400" />
              {trip.distance.toLocaleString('ru-RU')} км
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
            <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="truncate">{trip.route}</span>
          </div>
          {trip.purpose && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{trip.purpose}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>{trip.startMileage.toLocaleString('ru-RU')} → {trip.endMileage.toLocaleString('ru-RU')} км</span>
            {trip.serviceTicketId && (
              <span className="flex items-center gap-0.5">
                <Wrench className="h-3 w-3" />
                {trip.serviceTicketId}
              </span>
            )}
          </div>
          {trip.comment && (
            <p className="text-xs italic text-gray-400">{trip.comment}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onWaybill}
            title="Путевой лист"
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-500 transition-colors"
          >
            <FileText className="h-4 w-4" />
          </button>
          {canEdit && (
            <button
              onClick={onDelete}
              title="Удалить"
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
