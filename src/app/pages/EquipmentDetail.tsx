import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, getEquipmentStatusBadge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  ArrowLeft, CircleAlert, FileText, Image as ImageIcon, Wrench, Camera,
  DollarSign, TrendingUp, Clock, Plus, Bot, User, Calendar,
  CheckCircle, AlertTriangle, MapPin, ChevronRight, MessageSquare,
  Upload, Trash2, X,
} from 'lucide-react';
import {
  mockRepairRecords,
  loadEquipment, saveEquipment, EQUIPMENT_STORAGE_KEY,
  loadGanttRentals, GANTT_RENTALS_STORAGE_KEY,
  loadServiceTickets, SERVICE_STORAGE_KEY,
  loadPayments, PAYMENTS_STORAGE_KEY,
  loadShippingPhotos, saveShippingPhotos, SHIPPING_PHOTOS_KEY,
} from '../mock-data';
import type { ShippingPhoto } from '../types';
import { formatDate, formatCurrency, getDaysUntil } from '../lib/utils';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import type { Equipment, EquipmentOwnerType, RepairEventType } from '../types';
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';
import { ru } from 'date-fns/locale';

const ownerLabels: Record<EquipmentOwnerType, string> = {
  own: 'Собственная',
  investor: 'Техника инвестора',
  sublease: 'Субаренда',
};

const repairTypeLabels: Record<RepairEventType, string> = {
  repair: 'Ремонт',
  maintenance: 'Обслуживание',
  diagnostics: 'Диагностика',
  breakdown: 'Поломка',
};

const repairTypeBadge: Record<RepairEventType, 'danger' | 'warning' | 'info' | 'error'> = {
  repair: 'warning',
  maintenance: 'info',
  diagnostics: 'info',
  breakdown: 'error',
};

const EQ_STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Свободна',
  rented: 'В аренде',
  reserved: 'Забронирована',
  in_service: 'В сервисе',
  inactive: 'Списана',
};

const TYPE_LABELS: Record<string, string> = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const SERVICE_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово',
  closed: 'Закрыта',
};

export default function EquipmentDetail() {
  const { id } = useParams();

  // ── Reactive data loading from localStorage ──
  const [allEquipment, setAllEquipment] = useState(() => loadEquipment());
  const [allGanttRentals, setAllGanttRentals] = useState(() => loadGanttRentals());
  const [allServiceTickets, setAllServiceTickets] = useState(() => loadServiceTickets());
  const [allPayments, setAllPayments] = useState(() => loadPayments());

  useEffect(() => {
    const reload = () => {
      setAllEquipment(loadEquipment());
      setAllGanttRentals(loadGanttRentals());
      setAllServiceTickets(loadServiceTickets());
      setAllPayments(loadPayments());
    };
    const onStorage = (e: StorageEvent) => {
      if ([EQUIPMENT_STORAGE_KEY, GANTT_RENTALS_STORAGE_KEY, SERVICE_STORAGE_KEY, PAYMENTS_STORAGE_KEY].includes(e.key || '')) {
        reload();
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── Find equipment (from localStorage, not empty mock) ──
  const rawEquipment = allEquipment.find(e => e.id === id);

  // ── Enrich with active rental data (currentClient / returnDate) ──
  const activeRental = rawEquipment
    ? allGanttRentals.find(r =>
        r.equipmentInv === rawEquipment.inventoryNumber &&
        (r.status === 'active' || r.status === 'created'))
    : null;

  const equipment: Equipment | null = rawEquipment ? {
    ...rawEquipment,
    currentClient: rawEquipment.currentClient || activeRental?.client,
    returnDate: rawEquipment.returnDate || activeRental?.endDate,
  } : null;

  // ── Related data (all from localStorage) ──
  const ganttRentals = useMemo(
    () => equipment ? allGanttRentals.filter(r => r.equipmentInv === equipment.inventoryNumber).sort((a, b) => b.startDate.localeCompare(a.startDate)) : [],
    [equipment, allGanttRentals]
  );

  const serviceHistory = useMemo(
    () => equipment
      ? allServiceTickets.filter(s =>
          s.equipmentId === equipment.id ||
          (s.inventoryNumber && s.inventoryNumber === equipment.inventoryNumber)
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [],
    [equipment, allServiceTickets]
  );

  const repairRecords = [...mockRepairRecords]
    .filter(r => r.equipmentId === id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const [allShippingPhotos, setAllShippingPhotos] = useState<ShippingPhoto[]>(() => loadShippingPhotos());
  const shippingPhotos = useMemo(
    () => allShippingPhotos
      .filter(p => p.equipmentId === id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [allShippingPhotos, id],
  );

  // ── Photo upload state ──
  const [showUploadPhotoForm, setShowUploadPhotoForm] = useState(false);
  const [uploadEventType, setUploadEventType] = useState<'shipping' | 'receiving'>('shipping');
  const [uploadComment, setUploadComment] = useState('');
  const [uploadPending, setUploadPending] = useState<string[]>([]);  // base64 previews
  const mainPhotoInputRef = React.useRef<HTMLInputElement>(null);
  const shippingPhotoInputRef = React.useRef<HTMLInputElement>(null);

  // Compress image to base64 (max 800px, 70% quality)
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

  const handleMainPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !equipment) return;
    const base64 = await compressToBase64(file);
    const updated = loadEquipment().map(eq =>
      eq.id === equipment.id ? { ...eq, photo: base64 } : eq,
    );
    saveEquipment(updated);
    setEquipmentList(updated);
    e.target.value = '';
  };

  const handleMainPhotoDelete = () => {
    if (!equipment) return;
    const updated = loadEquipment().map(eq =>
      eq.id === equipment.id ? { ...eq, photo: undefined } : eq,
    );
    saveEquipment(updated);
    setEquipmentList(updated);
  };

  const handleShippingPhotoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const results = await Promise.all(files.map(f => compressToBase64(f)));
    setUploadPending(prev => [...prev, ...results]);
    e.target.value = '';
  };

  const handleShippingPhotoSave = () => {
    if (!uploadPending.length || !equipment) return;
    const newEvent: ShippingPhoto = {
      id: `sp-${Date.now()}`,
      equipmentId: equipment.id,
      date: new Date().toISOString().split('T')[0],
      type: uploadEventType,
      uploadedBy: 'Менеджер',
      photos: uploadPending,
      comment: uploadComment || undefined,
      source: 'manual',
    };
    const updated = [...allShippingPhotos, newEvent];
    saveShippingPhotos(updated);
    setAllShippingPhotos(updated);
    setUploadPending([]);
    setUploadComment('');
    setShowUploadPhotoForm(false);
  };

  // ── Modal state ──
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // ── Not found screen ──
  if (!equipment) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            <AlertTriangle className="h-8 w-8 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Техника не найдена</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Запись с ID <span className="font-mono">{id}</span> не существует или была удалена
          </p>
          <Link to="/equipment" className="mt-6 inline-flex items-center gap-2 text-[--color-primary] hover:underline">
            <ArrowLeft className="h-4 w-4" />
            Вернуться к списку
          </Link>
        </div>
      </div>
    );
  }

  // ── Financial calculations (current month, dynamic) ──
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysInCurrentMonth = getDaysInMonth(today);
  const currentMonthLabel = format(today, 'LLLL yyyy', { locale: ru });
  const monthStartStr = format(monthStart, 'yyyy-MM-dd');
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

  const monthRentals = ganttRentals.filter(r => {
    return r.startDate <= monthEndStr && r.endDate >= monthStartStr;
  });

  const daysRentedThisMonth = monthRentals.reduce((sum, r) => {
    const start = r.startDate < monthStartStr ? monthStartStr : r.startDate;
    const end = r.endDate > monthEndStr ? monthEndStr : r.endDate;
    const diff = Math.max(0, Math.ceil(
      (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
    ));
    return sum + diff;
  }, 0);

  const freeDaysThisMonth = daysInCurrentMonth - Math.min(daysRentedThisMonth, daysInCurrentMonth);
  const utilizationMonth = Math.round((Math.min(daysRentedThisMonth, daysInCurrentMonth) / daysInCurrentMonth) * 100);

  const actualMonthRevenue = monthRentals.reduce((sum, r) => {
    const rentalDays = Math.max(1, Math.ceil(
      (new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / (1000 * 60 * 60 * 24)
    ));
    const dailyRate = r.amount / rentalDays;
    const start = r.startDate < monthStartStr ? monthStartStr : r.startDate;
    const end = r.endDate > monthEndStr ? monthEndStr : r.endDate;
    const daysInPeriod = Math.max(0, Math.ceil(
      (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
    ));
    return sum + dailyRate * daysInPeriod;
  }, 0);

  const totalRevenue = ganttRentals
    .filter(r => r.status === 'returned' || r.status === 'closed' || r.status === 'active')
    .reduce((sum, r) => sum + r.amount, 0);

  // ── Manager commission calculation ──
  const getManagerCommission = () => {
    if (equipment.owner === 'own') {
      return { rate: '3%', commission: Math.round(actualMonthRevenue * 0.03), formula: `${formatCurrency(actualMonthRevenue)} × 3%` };
    }
    if (equipment.owner === 'investor') {
      const margin = actualMonthRevenue * 0.4;
      return { rate: '7% от 40%', commission: Math.round(margin * 0.07), formula: `${formatCurrency(actualMonthRevenue)} × 40% = ${formatCurrency(margin)}, × 7%` };
    }
    if (equipment.owner === 'sublease') {
      const profit = actualMonthRevenue - (equipment.subleasePrice || 0);
      return { rate: 'от разницы', commission: Math.max(profit, 0), formula: `${formatCurrency(actualMonthRevenue)} − ${formatCurrency(equipment.subleasePrice || 0)}` };
    }
    return { rate: '—', commission: 0, formula: '' };
  };
  const managerComm = getManagerCommission();

  // ── Maintenance alerts ──
  const daysUntilMaintenance = getDaysUntil(equipment.nextMaintenance);
  const openServiceTickets = serviceHistory.filter(s => s.status !== 'closed');
  const criticalTickets = openServiceTickets.filter(s => s.priority === 'critical' || s.priority === 'high');

  // ── Payments for equipment rentals ──
  const equipmentRentalIds = new Set(ganttRentals.map(r => r.id));
  const equipmentPayments = allPayments.filter(p => p.rentalId && equipmentRentalIds.has(p.rentalId));
  const totalPaidRevenue = equipmentPayments.reduce((sum, p) => sum + (p.paidAmount ?? p.amount), 0);

  const tabTriggerClass =
    'border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary] dark:text-gray-400 dark:hover:text-gray-200';

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* ── Header ── */}
      <div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
                {equipment.inventoryNumber}
              </h1>
              {getEquipmentStatusBadge(equipment.status)}
              <Badge variant={equipment.owner === 'own' ? 'success' : equipment.owner === 'investor' ? 'info' : 'warning'}>
                {ownerLabels[equipment.owner]}
              </Badge>
              {criticalTickets.length > 0 && (
                <Badge variant="error">
                  {criticalTickets.length} заявок требует внимания
                </Badge>
              )}
            </div>
            <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">
              {equipment.manufacturer} {equipment.model}
            </p>
            <div className="mt-1 flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500">
              <MapPin className="h-3.5 w-3.5" />
              {equipment.location}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowEditModal(true)}>
              Редактировать
            </Button>
            <Link to="/rentals">
              <Button variant="secondary" size="sm">
                <Calendar className="h-3.5 w-3.5" />
                Аренды
              </Button>
            </Link>
            <Link to="/service">
              <Button variant="secondary" size="sm">
                <Wrench className="h-3.5 w-3.5" />
                В сервис
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Quick Status Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Rental status */}
        <div className={`rounded-xl border p-4 ${
          equipment.status === 'rented'
            ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
            : equipment.status === 'reserved'
            ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
            : equipment.status === 'in_service'
            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Статус</p>
              <p className={`mt-1 text-base font-semibold ${
                equipment.status === 'rented' ? 'text-blue-700 dark:text-blue-300' :
                equipment.status === 'reserved' ? 'text-amber-700 dark:text-amber-300' :
                equipment.status === 'in_service' ? 'text-red-700 dark:text-red-300' :
                'text-green-700 dark:text-green-300'
              }`}>{EQ_STATUS_LABELS[equipment.status]}</p>
              {equipment.currentClient && (
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{equipment.currentClient}</p>
              )}
              {equipment.returnDate && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Возврат: {formatDate(equipment.returnDate)}
                </p>
              )}
            </div>
            <Calendar className={`h-5 w-5 ${
              equipment.status === 'rented' ? 'text-blue-400' :
              equipment.status === 'reserved' ? 'text-amber-400' :
              equipment.status === 'in_service' ? 'text-red-400' :
              'text-green-400'
            }`} />
          </div>
        </div>

        {/* Next maintenance */}
        <div className={`rounded-xl border p-4 ${
          daysUntilMaintenance <= 7
            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            : daysUntilMaintenance <= 30
            ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
            : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Следующее ТО</p>
              <p className={`mt-1 text-base font-semibold ${
                daysUntilMaintenance <= 7 ? 'text-red-700 dark:text-red-300' :
                daysUntilMaintenance <= 30 ? 'text-amber-700 dark:text-amber-300' :
                'text-gray-900 dark:text-white'
              }`}>{formatDate(equipment.nextMaintenance)}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {daysUntilMaintenance > 0 ? `через ${daysUntilMaintenance} дн.` : 'просрочено!'}
              </p>
            </div>
            <Wrench className={`h-5 w-5 ${
              daysUntilMaintenance <= 7 ? 'text-red-400' :
              daysUntilMaintenance <= 30 ? 'text-amber-400' :
              'text-gray-400'
            }`} />
          </div>
        </div>

        {/* Monthly utilization */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Утилизация · {format(today, 'MMM', { locale: ru })}</p>
              <p className="mt-1 text-base font-semibold text-gray-900 dark:text-white">{utilizationMonth}%</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {daysRentedThisMonth} из {daysInCurrentMonth} дней
              </p>
            </div>
            <TrendingUp className="h-5 w-5 text-purple-400" />
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-full rounded-full bg-purple-500" style={{ width: `${utilizationMonth}%` }} />
          </div>
        </div>

        {/* Open service tickets */}
        <div className={`rounded-xl border p-4 ${
          criticalTickets.length > 0
            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            : openServiceTickets.length > 0
            ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
            : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Сервисные заявки</p>
              <p className={`mt-1 text-base font-semibold ${
                criticalTickets.length > 0 ? 'text-red-700 dark:text-red-300' :
                openServiceTickets.length > 0 ? 'text-amber-700 dark:text-amber-300' :
                'text-gray-900 dark:text-white'
              }`}>
                {openServiceTickets.length > 0 ? `${openServiceTickets.length} открыт.` : 'Нет заявок'}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                всего {serviceHistory.length} в истории
              </p>
            </div>
            <AlertTriangle className={`h-5 w-5 ${
              criticalTickets.length > 0 ? 'text-red-400' :
              openServiceTickets.length > 0 ? 'text-amber-400' :
              'text-gray-400'
            }`} />
          </div>
        </div>
      </div>

      {/* ── Maintenance / Service Alerts ── */}
      {daysUntilMaintenance <= 30 && (
        <div className={`rounded-lg border p-4 ${
          daysUntilMaintenance <= 7
            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
        }`}>
          <div className="flex items-start gap-3">
            <CircleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${daysUntilMaintenance <= 7 ? 'text-red-600' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`font-medium ${daysUntilMaintenance <= 7 ? 'text-red-900 dark:text-red-200' : 'text-amber-900 dark:text-amber-200'}`}>
                Техническое обслуживание через {daysUntilMaintenance} дней
              </p>
              <p className={`mt-0.5 text-sm ${daysUntilMaintenance <= 7 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                Запланировано на {formatDate(equipment.nextMaintenance)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo and Key Info ── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="p-0">
            {/* Hidden file input for main photo */}
            <input
              ref={mainPhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleMainPhotoUpload}
            />
            <div className="group relative">
              {equipment.photo ? (
                <img src={equipment.photo} alt={equipment.model} className="h-64 w-full rounded-lg object-cover" />
              ) : (
                <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                  <ImageIcon className="h-16 w-16 text-gray-400" />
                </div>
              )}
              {/* Photo action overlay */}
              <div className="absolute inset-0 flex items-end justify-center rounded-lg bg-black/0 pb-3 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                <div className="flex gap-2">
                  <button
                    onClick={() => mainPhotoInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 shadow hover:bg-white"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {equipment.photo ? 'Заменить' : 'Загрузить'}
                  </button>
                  {equipment.photo && (
                    <button
                      onClick={handleMainPhotoDelete}
                      className="flex items-center gap-1.5 rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-red-600 shadow hover:bg-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="px-3 py-2 text-center text-xs text-gray-400 dark:text-gray-500">
              {equipment.photo ? 'Наведите для изменения фото' : 'Наведите для загрузки фото'}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Основные характеристики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <InfoField label="Производитель" value={equipment.manufacturer} />
              <InfoField label="Модель" value={equipment.model} />
              <InfoField label="Тип" value={TYPE_LABELS[equipment.type] || equipment.type} />
              <InfoField label="Привод" value={equipment.drive === 'diesel' ? 'Дизель' : 'Электро'} />
              <InfoField label="Серийный номер" value={equipment.serialNumber} mono />
              <InfoField label="Инвентарный номер" value={equipment.inventoryNumber} mono />
              <InfoField label="Год выпуска" value={String(equipment.year)} />
              <InfoField label="Моточасы" value={`${equipment.hours} ч`} />
              <InfoField label="Высота подъёма" value={`${equipment.liftHeight} м`} />
              {equipment.workingHeight && <InfoField label="Рабочая высота" value={`${equipment.workingHeight} м`} />}
              {equipment.loadCapacity && <InfoField label="Грузоподъёмность" value={`${equipment.loadCapacity} кг`} />}
              {equipment.dimensions && <InfoField label="Габариты" value={equipment.dimensions} />}
              {equipment.weight && <InfoField label="Масса" value={`${equipment.weight} кг`} />}
              <InfoField label="Локация" value={equipment.location} />
              <InfoField label="Владелец" value={ownerLabels[equipment.owner]} />
              {equipment.owner === 'sublease' && equipment.subleasePrice && (
                <InfoField label="Стоимость субаренды" value={`${formatCurrency(equipment.subleasePrice)}/мес`} highlight="orange" />
              )}
            </div>

            {/* Current rental info */}
            {equipment.currentClient && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <InfoField label="Текущий клиент" value={equipment.currentClient} />
                  {activeRental?.startDate && (
                    <InfoField label="Начало аренды" value={formatDate(activeRental.startDate)} />
                  )}
                  {equipment.returnDate && (
                    <InfoField label="Плановый возврат" value={formatDate(equipment.returnDate)} />
                  )}
                  {activeRental?.manager && (
                    <InfoField label="Менеджер" value={activeRental.manager} />
                  )}
                  {activeRental?.amount && (
                    <InfoField label="Сумма аренды" value={formatCurrency(activeRental.amount)} />
                  )}
                </div>
              </div>
            )}

            {/* Maintenance dates */}
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:grid-cols-3">
              <InfoField label="След. ТО" value={formatDate(equipment.nextMaintenance)} />
              {equipment.maintenanceCHTO && <InfoField label="Дата ЧТО" value={formatDate(equipment.maintenanceCHTO)} />}
              {equipment.maintenancePTO && <InfoField label="Дата ПТО" value={formatDate(equipment.maintenancePTO)} />}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <Tabs.Root defaultValue="overview" className="space-y-6">
        <Tabs.List className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          <Tabs.Trigger value="overview" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Обзор</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="financial" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Финансы</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="rental-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Аренды {ganttRentals.length > 0 && <span className="rounded-full bg-gray-200 px-1.5 text-xs dark:bg-gray-700">{ganttRentals.length}</span>}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="service-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Сервис {openServiceTickets.length > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">{openServiceTickets.length}</span>}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="repair-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Ремонты</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="photos" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Фото</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="documents" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Документы</span>
          </Tabs.Trigger>
        </Tabs.List>

        {/* ══ OVERVIEW TAB ══ */}
        <Tabs.Content value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Rental block */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[--color-primary]" />
                    Аренда
                  </CardTitle>
                  <Link to="/rentals" className="flex items-center gap-1 text-xs text-[--color-primary] hover:underline">
                    Открыть планировщик <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Статус аренды</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-white">{EQ_STATUS_LABELS[equipment.status]}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Всего аренд</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-white">{ganttRentals.length}</p>
                  </div>
                  {equipment.currentClient ? (
                    <>
                      <div className="col-span-2 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Текущий клиент</p>
                        <p className="mt-1 font-medium text-gray-900 dark:text-white">{equipment.currentClient}</p>
                        {equipment.returnDate && (
                          <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
                            Возврат: {formatDate(equipment.returnDate)}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">Техника свободна</p>
                      {ganttRentals.some(r => r.status === 'created' && r.startDate > format(today, 'yyyy-MM-dd')) && (
                        <p className="mt-0.5 text-xs text-green-600 dark:text-green-500">
                          Есть предстоящая бронь
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Last 3 rentals */}
                {ganttRentals.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Последние аренды:</p>
                    <div className="space-y-1.5">
                      {ganttRentals.slice(0, 3).map(r => (
                        <div key={r.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900/30">
                          <div>
                            <span className="text-sm text-gray-900 dark:text-white">{r.client}</span>
                            <span className="ml-2 text-xs text-gray-500">
                              {formatDate(r.startDate)} — {formatDate(r.endDate)}
                            </span>
                          </div>
                          <Badge variant={r.status === 'active' ? 'info' : r.status === 'returned' || r.status === 'closed' ? 'default' : 'warning'} >
                            {r.status === 'active' ? 'Активна' : r.status === 'returned' ? 'Возвр.' : r.status === 'closed' ? 'Закр.' : 'Бронь'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service block */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-[--color-primary]" />
                    Сервис
                  </CardTitle>
                  <Link to="/service" className="flex items-center gap-1 text-xs text-[--color-primary] hover:underline">
                    Открыть сервис <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-lg p-3 ${daysUntilMaintenance <= 7 ? 'bg-red-50 dark:bg-red-900/20' : daysUntilMaintenance <= 30 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-gray-900/50'}`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Следующее ТО</p>
                    <p className={`mt-1 font-medium ${daysUntilMaintenance <= 7 ? 'text-red-700 dark:text-red-300' : daysUntilMaintenance <= 30 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
                      {formatDate(equipment.nextMaintenance)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {daysUntilMaintenance > 0 ? `через ${daysUntilMaintenance} дн.` : 'просрочено'}
                    </p>
                  </div>
                  {equipment.maintenanceCHTO && (
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                      <p className="text-xs text-gray-500 dark:text-gray-400">ЧТО</p>
                      <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(equipment.maintenanceCHTO)}</p>
                    </div>
                  )}
                  {equipment.maintenancePTO && (
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                      <p className="text-xs text-gray-500 dark:text-gray-400">ПТО</p>
                      <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(equipment.maintenancePTO)}</p>
                    </div>
                  )}
                  <div className={`rounded-lg p-3 ${openServiceTickets.length > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-gray-900/50'}`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Открытых заявок</p>
                    <p className={`mt-1 font-medium ${openServiceTickets.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
                      {openServiceTickets.length}
                    </p>
                  </div>
                </div>

                {openServiceTickets.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Открытые заявки:</p>
                    <div className="space-y-1.5">
                      {openServiceTickets.slice(0, 3).map(t => (
                        <div key={t.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900/30">
                          <div className="min-w-0 flex-1">
                            <span className="truncate text-sm text-gray-900 dark:text-white">{t.reason}</span>
                          </div>
                          <Badge variant={t.priority === 'critical' ? 'error' : t.priority === 'high' ? 'warning' : 'info'}>
                            {t.priority === 'critical' ? 'Критич.' : t.priority === 'high' ? 'Высокий' : SERVICE_STATUS_LABELS[t.status]}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Economics summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[--color-primary]" />
                Экономика
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Плановый доход/мес</p>
                  <p className="mt-1 text-lg font-semibold text-blue-700 dark:text-blue-300">{formatCurrency(equipment.plannedMonthlyRevenue)}</p>
                </div>
                <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Факт. доход · {format(today, 'MMM', { locale: ru })}</p>
                  <p className="mt-1 text-lg font-semibold text-green-700 dark:text-green-300">{formatCurrency(Math.round(actualMonthRevenue))}</p>
                </div>
                <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-900/20">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Суммарная выручка</p>
                  <p className="mt-1 text-lg font-semibold text-purple-700 dark:text-purple-300">{formatCurrency(totalRevenue)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{ganttRentals.filter(r => r.status !== 'created').length} аренд</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Утилизация месяца</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{utilizationMonth}%</p>
                  <p className="mt-0.5 text-xs text-gray-500">{daysRentedThisMonth} / {daysInCurrentMonth} дн.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {equipment.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Примечания</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{equipment.notes}</p>
              </CardContent>
            </Card>
          )}
        </Tabs.Content>

        {/* ══ FINANCIAL TAB ══ */}
        <Tabs.Content value="financial">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[--color-primary]" />
                  Финансовые показатели · {currentMonthLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Плановый доход/мес</p>
                    <p className="mt-0.5 text-xl text-blue-700 dark:text-blue-300">{formatCurrency(equipment.plannedMonthlyRevenue)}</p>
                  </div>
                  <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Факт. доход за месяц</p>
                    <p className="mt-0.5 text-xl text-green-700 dark:text-green-300">{formatCurrency(Math.round(actualMonthRevenue))}</p>
                  </div>
                  <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-900/20">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Утилизация за месяц</p>
                    <p className="mt-0.5 text-xl text-purple-700 dark:text-purple-300">{utilizationMonth}%</p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-purple-100 dark:bg-purple-900/30">
                      <div className="h-full rounded-full bg-purple-500" style={{ width: `${utilizationMonth}%` }} />
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Дней в аренде / свободно</p>
                    <p className="mt-0.5 text-xl text-gray-900 dark:text-white">
                      {daysRentedThisMonth} <span className="text-sm text-gray-400">/ {freeDaysThisMonth}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Выполнение плана</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {equipment.plannedMonthlyRevenue > 0
                        ? Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full ${actualMonthRevenue >= equipment.plannedMonthlyRevenue ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(100, equipment.plannedMonthlyRevenue > 0 ? Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100) : 0)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Суммарная выручка (все аренды)</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalRevenue)}</span>
                  </div>
                  {totalPaidRevenue > 0 && (
                    <div className="mt-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Из них оплачено</span>
                      <span className="font-medium text-green-700 dark:text-green-400">{formatCurrency(totalPaidRevenue)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[--color-primary]" />
                  Расчёт для менеджера
                </CardTitle>
                <CardDescription>Владелец: {ownerLabels[equipment.owner]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className={`rounded-lg p-4 ${
                  equipment.owner === 'own' ? 'bg-blue-50 dark:bg-blue-900/20' :
                  equipment.owner === 'investor' ? 'bg-purple-50 dark:bg-purple-900/20' :
                  'bg-orange-50 dark:bg-orange-900/20'
                }`}>
                  {equipment.owner === 'own' && (
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Собственная техника: менеджер получает <span className="font-medium">3%</span> от результата</p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{managerComm.formula}</p>
                      <p className="mt-1 text-2xl text-blue-700 dark:text-blue-300">{formatCurrency(managerComm.commission)}</p>
                    </div>
                  )}
                  {equipment.owner === 'investor' && (
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Техника инвестора: 100% выручки − 60%, от оставшихся 40% менеджер получает <span className="font-medium">7%</span></p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{managerComm.formula}</p>
                      <p className="mt-1 text-2xl text-purple-700 dark:text-purple-300">{formatCurrency(managerComm.commission)}</p>
                    </div>
                  )}
                  {equipment.owner === 'sublease' && (
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Субаренда: финансовый результат = цена сдачи − цена взятия</p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{managerComm.formula}</p>
                      <p className={`mt-1 text-2xl ${managerComm.commission >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-600'}`}>
                        {formatCurrency(managerComm.commission)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>Факт. выручка за месяц</span>
                    <span className="text-gray-900 dark:text-white">{formatCurrency(Math.round(actualMonthRevenue))}</span>
                  </div>
                  {equipment.owner === 'sublease' && equipment.subleasePrice && (
                    <div className="flex justify-between">
                      <span>Стоимость субаренды</span>
                      <span className="text-orange-600">−{formatCurrency(equipment.subleasePrice)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-1 dark:border-gray-700">
                    <span className="font-medium text-gray-900 dark:text-white">Комиссия менеджера ({managerComm.rate})</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(managerComm.commission)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </Tabs.Content>

        {/* ══ RENTAL HISTORY TAB ══ */}
        <Tabs.Content value="rental-history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>История аренды</CardTitle>
                  <CardDescription>{ganttRentals.length} записей</CardDescription>
                </div>
                <Link to="/rentals">
                  <Button size="sm" variant="secondary">
                    <Plus className="h-3.5 w-3.5" />
                    Новая аренда
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {ganttRentals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Период</TableHead>
                      <TableHead>Дней</TableHead>
                      <TableHead>Менеджер</TableHead>
                      <TableHead>Стоимость</TableHead>
                      <TableHead>Оплата</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ganttRentals.map(gr => {
                      const days = Math.ceil((new Date(gr.endDate).getTime() - new Date(gr.startDate).getTime()) / (1000 * 60 * 60 * 24));
                      const rentalPmts = allPayments.filter(p => p.rentalId === gr.id);
                      const paid = rentalPmts.reduce((s, p) => s + (p.paidAmount ?? p.amount), 0);
                      return (
                        <TableRow key={gr.id}>
                          <TableCell>
                            <span className="font-mono text-xs text-[--color-primary]">{gr.id}</span>
                          </TableCell>
                          <TableCell>{gr.client}</TableCell>
                          <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                            {formatDate(gr.startDate)} — {formatDate(gr.endDate)}
                          </TableCell>
                          <TableCell>{days}</TableCell>
                          <TableCell className="text-sm">{gr.managerInitials}</TableCell>
                          <TableCell>{formatCurrency(gr.amount)}</TableCell>
                          <TableCell>
                            <Badge variant={gr.paymentStatus === 'paid' ? 'success' : gr.paymentStatus === 'partial' ? 'warning' : 'error'}>
                              {gr.paymentStatus === 'paid' ? 'Оплачено' : gr.paymentStatus === 'partial' ? `${formatCurrency(paid)}` : 'Не опл.'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              gr.status === 'active' ? 'info' :
                              gr.status === 'returned' ? 'success' :
                              gr.status === 'closed' ? 'default' : 'warning'
                            }>
                              {gr.status === 'active' ? 'Активна' :
                               gr.status === 'returned' ? 'Возвр.' :
                               gr.status === 'closed' ? 'Закр.' : 'Бронь'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Calendar className="h-12 w-12" />} text="История аренды пуста">
                  <Link to="/rentals">
                    <Button variant="secondary" size="sm" className="mt-4">Открыть планировщик</Button>
                  </Link>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* ══ SERVICE HISTORY TAB ══ */}
        <Tabs.Content value="service-history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Сервисные заявки</CardTitle>
                  <CardDescription>
                    {openServiceTickets.length} открытых · {serviceHistory.length} всего
                  </CardDescription>
                </div>
                <Link to="/service">
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    Создать заявку
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {serviceHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Причина</TableHead>
                      <TableHead>Описание</TableHead>
                      <TableHead>Создана</TableHead>
                      <TableHead>Приоритет</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceHistory.map(ticket => (
                      <TableRow key={ticket.id}>
                        <TableCell>
                          <Link to={`/service/${ticket.id}`} className="font-mono text-xs text-[--color-primary] hover:underline">
                            {ticket.id}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate">{ticket.reason}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-gray-500 dark:text-gray-400">
                          {ticket.description}
                        </TableCell>
                        <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.priority === 'critical' ? 'error' :
                            ticket.priority === 'high' ? 'warning' :
                            ticket.priority === 'medium' ? 'info' : 'default'
                          }>
                            {ticket.priority === 'critical' ? 'Критич.' :
                             ticket.priority === 'high' ? 'Высокий' :
                             ticket.priority === 'medium' ? 'Средний' : 'Низкий'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.status === 'in_progress' ? 'info' :
                            ticket.status === 'waiting_parts' ? 'warning' :
                            ticket.status === 'ready' ? 'success' :
                            ticket.status === 'closed' ? 'default' : 'default'
                          }>
                            {SERVICE_STATUS_LABELS[ticket.status] || ticket.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Wrench className="h-12 w-12" />} text="Сервисных заявок нет">
                  <Link to="/service">
                    <Button variant="secondary" size="sm" className="mt-4">Создать заявку</Button>
                  </Link>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* ══ REPAIR HISTORY TAB ══ */}
        <Tabs.Content value="repair-history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>История ремонтов</CardTitle>
                  <CardDescription>{repairRecords.length} записей</CardDescription>
                </div>
                <Button size="sm" onClick={() => setShowRepairModal(true)}>
                  <Plus className="h-4 w-4" />
                  Добавить запись
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {repairRecords.length > 0 ? (
                <div className="space-y-3">
                  {repairRecords.map(record => (
                    <div key={record.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={repairTypeBadge[record.type]}>{repairTypeLabels[record.type]}</Badge>
                            <Badge variant={record.status === 'completed' ? 'success' : record.status === 'in_progress' ? 'info' : 'default'}>
                              {record.status === 'completed' ? 'Выполнено' : record.status === 'in_progress' ? 'В работе' : 'Запланировано'}
                            </Badge>
                            {record.source === 'bot' && (
                              <span className="flex items-center gap-1 text-xs text-gray-400"><Bot className="h-3 w-3" /> Из бота</span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-gray-900 dark:text-white">{record.description}</p>
                          {record.comment && (
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{record.comment}</p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDate(record.date)}</span>
                            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {record.mechanic}</span>
                          </div>
                        </div>
                        {record.cost != null && record.cost > 0 && (
                          <p className="ml-4 font-medium text-gray-900 dark:text-white">{formatCurrency(record.cost)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Всего затрат на ремонты</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatCurrency(repairRecords.reduce((sum, r) => sum + (r.cost || 0), 0))}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState icon={<Wrench className="h-12 w-12" />} text="Записей о ремонтах нет" />
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* ══ PHOTOS TAB ══ */}
        <Tabs.Content value="photos">
          {/* Hidden file input for shipping photos */}
          <input
            ref={shippingPhotoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleShippingPhotoFilePick}
          />
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Фото отгрузок и приёмки</CardTitle>
                  <CardDescription>{shippingPhotos.length} событий</CardDescription>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setShowUploadPhotoForm(v => !v)}>
                  <Plus className="h-4 w-4" />
                  Загрузить фото
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Upload form */}
              {showUploadPhotoForm && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-200">Новое фотособытие</span>
                    <button
                      onClick={() => { setShowUploadPhotoForm(false); setUploadPending([]); setUploadComment(''); }}
                      className="rounded p-1 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Event type */}
                  <div className="flex gap-2">
                    {(['shipping', 'receiving'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setUploadEventType(t)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          uploadEventType === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        {t === 'shipping' ? 'Отгрузка' : 'Приёмка'}
                      </button>
                    ))}
                  </div>

                  {/* Comment */}
                  <input
                    type="text"
                    placeholder="Комментарий (необязательно)"
                    value={uploadComment}
                    onChange={e => setUploadComment(e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  {/* File picker */}
                  <div>
                    <button
                      onClick={() => shippingPhotoInputRef.current?.click()}
                      className="flex items-center gap-2 rounded-md border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors w-full justify-center"
                    >
                      <Camera className="h-4 w-4" />
                      Выбрать фотографии (можно несколько)
                    </button>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Фото сжимаются до 800px и хранятся в браузере. Рекомендуется &lt;5 фото за раз.
                    </p>
                  </div>

                  {/* Pending previews */}
                  {uploadPending.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Выбрано: {uploadPending.length} фото</span>
                        <button onClick={() => setUploadPending([])} className="text-xs text-red-500 hover:underline">Очистить</button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {uploadPending.map((src, i) => (
                          <div key={i} className="relative shrink-0">
                            <img src={src} alt={`Preview ${i + 1}`} className="h-20 w-28 rounded-md border border-gray-200 dark:border-gray-700 object-cover" />
                            <button
                              onClick={() => setUploadPending(prev => prev.filter((_, idx) => idx !== i))}
                              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button size="sm" onClick={handleShippingPhotoSave} disabled={!uploadPending.length}>
                    <Upload className="h-4 w-4" />
                    Сохранить событие
                  </Button>
                </div>
              )}

              {/* Photo events list */}
              {shippingPhotos.length > 0 ? (
                <div className="space-y-6">
                  {shippingPhotos.map(event => (
                    <div key={event.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={event.type === 'shipping' ? 'info' : 'success'}>
                            {event.type === 'shipping' ? 'Отгрузка' : 'Приёмка (возврат)'}
                          </Badge>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(event.date)}</span>
                          {event.source === 'bot' && (
                            <span className="flex items-center gap-1 text-xs text-gray-400"><Bot className="h-3 w-3" /> Из бота</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">Загрузил: {event.uploadedBy}</span>
                          <button
                            onClick={() => {
                              const updated = allShippingPhotos.filter(p => p.id !== event.id);
                              saveShippingPhotos(updated);
                              setAllShippingPhotos(updated);
                            }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-red-500"
                            title="Удалить событие"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {event.comment && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{event.comment}</p>}
                      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                        {event.photos.map((photo, idx) => (
                          <img key={idx} src={photo} alt={`Фото ${idx + 1}`}
                            className="h-32 w-48 shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 object-cover cursor-pointer hover:opacity-90"
                            onClick={() => window.open(photo, '_blank')}
                          />
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{event.photos.length} фото · нажмите для просмотра</p>
                    </div>
                  ))}
                </div>
              ) : (
                !showUploadPhotoForm && (
                  <EmptyState icon={<Camera className="h-12 w-12" />} text="Фотографий пока нет">
                    <button
                      onClick={() => setShowUploadPhotoForm(true)}
                      className="mt-3 text-sm text-[--color-primary] hover:underline"
                    >
                      Загрузить первое фото
                    </button>
                  </EmptyState>
                )
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* ══ DOCUMENTS TAB ══ */}
        <Tabs.Content value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Документы</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState icon={<FileText className="h-12 w-12" />} text="Документов нет">
                <Button variant="secondary" size="sm" className="mt-4">Загрузить документ</Button>
              </EmptyState>
            </CardContent>
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      {/* ── Modals ── */}
      <AddRepairModal open={showRepairModal} onOpenChange={setShowRepairModal} />
      <EditEquipmentModal
        open={showEditModal}
        equipment={equipment}
        onOpenChange={setShowEditModal}
        onSave={(updated) => {
          const list = loadEquipment().map(e => e.id === updated.id ? updated : e);
          saveEquipment(list);
          setAllEquipment(list);
          setShowEditModal(false);
        }}
      />
    </div>
  );
}

// ── Helper Components ──

function InfoField({ label, value, mono, highlight }: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'orange';
}) {
  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`font-medium ${mono ? 'font-mono text-sm' : ''} ${highlight === 'orange' ? 'text-orange-600' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto text-gray-400">{icon}</div>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{text}</p>
      {children}
    </div>
  );
}

function AddRepairModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState({ date: '', type: 'maintenance', description: '', comment: '', mechanic: '', status: 'completed', cost: '' });
  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
          <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">Добавить запись о ремонте</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">Заполните информацию о ремонте или обслуживании</Dialog.Description>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Дата</label>
                <input type="date" value={form.date} onChange={e => update('date', e.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Тип события</label>
                <Select value={form.type} onValueChange={v => update('type', v)}>
                  <SelectTrigger className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maintenance">Обслуживание</SelectItem>
                    <SelectItem value="repair">Ремонт</SelectItem>
                    <SelectItem value="diagnostics">Диагностика</SelectItem>
                    <SelectItem value="breakdown">Поломка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Описание работ</label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Что было сделано..." value={form.description} onChange={e => update('description', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Комментарий</label>
              <textarea
                className="flex min-h-[40px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Дополнительно..." value={form.comment} onChange={e => update('comment', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Исполнитель</label>
                <input value={form.mechanic} onChange={e => update('mechanic', e.target.value)} placeholder="Фамилия И.О."
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Сумма, ₽</label>
                <input type="number" value={form.cost} onChange={e => update('cost', e.target.value)} placeholder="0"
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Статус</label>
              <Select value={form.status} onValueChange={v => update('status', v)}>
                <SelectTrigger className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Выполнено</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="planned">Запланировано</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={() => onOpenChange(false)}>Сохранить</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Reusable form primitives for the Edit modal ──────────────────────────────

function FormField({
  label, hint, unit, required, children,
}: {
  label: string;
  hint?: string;
  unit?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
        {unit && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
            {unit}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

function FormSection({
  title, icon, children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

function FieldInput({
  value, onChange, type = 'text', placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
    />
  );
}

function FieldSelect({
  value, onValueChange, options, placeholder,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
        <SelectValue placeholder={placeholder || 'Выберите...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

function EditEquipmentModal({
  open, equipment, onOpenChange, onSave,
}: {
  open: boolean;
  equipment: Equipment;
  onOpenChange: (v: boolean) => void;
  onSave: (updated: Equipment) => void;
}) {
  const [form, setForm] = useState(equipment);

  useEffect(() => {
    if (open) setForm(equipment);
  }, [open, equipment]);

  const set = (field: keyof Equipment, value: string | number | undefined) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const setStr = (field: keyof Equipment) => (v: string) => set(field, v);
  const setNum = (field: keyof Equipment) => (v: string) => set(field, v === '' ? undefined : Number(v));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900">

          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <Dialog.Title className="text-lg font-bold text-gray-900 dark:text-white">
              Редактировать технику
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {equipment.inventoryNumber} · {equipment.manufacturer} {equipment.model}
            </Dialog.Description>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(92vh - 130px)' }}>
            <div className="space-y-6 px-6 py-5">

              {/* ── Блок 1: Идентификация ── */}
              <FormSection title="Идентификация" icon={<FileText className="h-3.5 w-3.5" />}>
                <FormField
                  label="Инвентарный номер"
                  hint="Внутренний номер учёта техники в компании"
                  required
                >
                  <FieldInput
                    value={form.inventoryNumber}
                    onChange={setStr('inventoryNumber')}
                    placeholder="Например: 044, ПП-12"
                  />
                </FormField>

                <FormField
                  label="Серийный номер / SN"
                  hint="Номер с шильдика или паспорта техники"
                >
                  <FieldInput
                    value={form.serialNumber}
                    onChange={setStr('serialNumber')}
                    placeholder="Например: B200063919"
                  />
                </FormField>

                <FormField
                  label="Производитель"
                  hint="Бренд: JLG, Genie, Haulotte, Manitou…"
                  required
                >
                  <FieldInput
                    value={form.manufacturer}
                    onChange={setStr('manufacturer')}
                    placeholder="Например: JLG"
                  />
                </FormField>

                <FormField
                  label="Модель"
                  hint="Заводская модель техники"
                  required
                >
                  <FieldInput
                    value={form.model}
                    onChange={setStr('model')}
                    placeholder="Например: 1932R"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 2: Характеристики ── */}
              <FormSection title="Технические характеристики" icon={<Wrench className="h-3.5 w-3.5" />}>
                <FormField label="Тип техники" hint="Выбор из справочника">
                  <FieldSelect
                    value={form.type}
                    onValueChange={setStr('type')}
                    options={[
                      { value: 'scissor',     label: '✂  Ножничный подъёмник' },
                      { value: 'articulated', label: '🦾 Коленчатый подъёмник' },
                      { value: 'telescopic',  label: '🔭 Телескопический подъёмник' },
                    ]}
                  />
                </FormField>

                <FormField label="Привод" hint="Тип энергоустановки">
                  <FieldSelect
                    value={form.drive}
                    onValueChange={setStr('drive')}
                    options={[
                      { value: 'diesel',   label: '⛽ Дизельный' },
                      { value: 'electric', label: '⚡ Электрический' },
                    ]}
                  />
                </FormField>

                <FormField
                  label="Год выпуска"
                  hint="Год изготовления по паспорту техники"
                >
                  <FieldInput
                    type="number"
                    value={String(form.year)}
                    onChange={setNum('year')}
                    placeholder="Например: 2022"
                  />
                </FormField>

                <FormField
                  label="Моточасы / наработка"
                  unit="м/ч"
                  hint="Текущие показания счётчика наработки"
                >
                  <FieldInput
                    type="number"
                    value={String(form.hours)}
                    onChange={setNum('hours')}
                    placeholder="Например: 1250"
                  />
                </FormField>

                <FormField
                  label="Высота подъёма"
                  unit="м"
                  hint="Максимальная высота подъёма платформы"
                >
                  <FieldInput
                    type="number"
                    value={String(form.liftHeight)}
                    onChange={setNum('liftHeight')}
                    placeholder="Например: 8"
                  />
                </FormField>

                <FormField
                  label="Рабочая высота"
                  unit="м"
                  hint="Максимальная рабочая высота с оператором"
                >
                  <FieldInput
                    type="number"
                    value={String(form.workingHeight || '')}
                    onChange={setNum('workingHeight')}
                    placeholder="Обычно = высота подъёма + 2 м"
                  />
                </FormField>

                <FormField
                  label="Грузоподъёмность"
                  unit="кг"
                  hint="Максимальная нагрузка на платформу"
                >
                  <FieldInput
                    type="number"
                    value={String(form.loadCapacity || '')}
                    onChange={setNum('loadCapacity')}
                    placeholder="Например: 230"
                  />
                </FormField>

                <FormField
                  label="Масса техники"
                  unit="кг"
                  hint="Снаряжённая масса по паспорту"
                >
                  <FieldInput
                    type="number"
                    value={String(form.weight || '')}
                    onChange={setNum('weight')}
                    placeholder="Например: 1800"
                  />
                </FormField>

                <FormField
                  label="Габариты"
                  hint="Длина × ширина × высота в сложенном положении"
                  // spans full width
                >
                  <FieldInput
                    value={form.dimensions || ''}
                    onChange={setStr('dimensions')}
                    placeholder="Например: 2.44 × 0.81 × 1.97 м"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 3: Владение и размещение ── */}
              <FormSection title="Владение и размещение" icon={<MapPin className="h-3.5 w-3.5" />}>
                <FormField label="Собственник техники" hint="Определяет схему расчёта комиссии менеджера">
                  <FieldSelect
                    value={form.owner}
                    onValueChange={setStr('owner')}
                    options={[
                      { value: 'own',      label: '🏢 Собственная (компания)' },
                      { value: 'investor', label: '👤 Техника инвестора' },
                      { value: 'sublease', label: '🔄 Субаренда' },
                    ]}
                  />
                </FormField>

                {form.owner === 'sublease' && (
                  <FormField
                    label="Стоимость субаренды"
                    unit="₽/мес"
                    hint="Ежемесячная стоимость аренды у поставщика"
                  >
                    <FieldInput
                      type="number"
                      value={String(form.subleasePrice || '')}
                      onChange={setNum('subleasePrice')}
                      placeholder="Например: 50000"
                    />
                  </FormField>
                )}

                <FormField
                  label="Локация / склад"
                  hint="Текущее место хранения или размещения техники"
                >
                  <FieldInput
                    value={form.location}
                    onChange={setStr('location')}
                    placeholder="Например: Казань, склад 1"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 4: Экономика и обслуживание ── */}
              <FormSection title="Экономика и обслуживание" icon={<DollarSign className="h-3.5 w-3.5" />}>
                <FormField
                  label="Плановый доход в месяц"
                  unit="₽"
                  hint="Ориентир для оценки загрузки и эффективности"
                >
                  <FieldInput
                    type="number"
                    value={String(form.plannedMonthlyRevenue)}
                    onChange={setNum('plannedMonthlyRevenue')}
                    placeholder="Например: 80000"
                  />
                </FormField>

                <FormField
                  label="Следующее ТО"
                  hint="Дата планового технического обслуживания"
                  required
                >
                  <FieldInput
                    type="date"
                    value={form.nextMaintenance}
                    onChange={setStr('nextMaintenance')}
                  />
                </FormField>

                <FormField
                  label="Дата ЧТО"
                  hint="Дата последнего частичного технического обслуживания"
                >
                  <FieldInput
                    type="date"
                    value={form.maintenanceCHTO || ''}
                    onChange={setStr('maintenanceCHTO')}
                  />
                </FormField>

                <FormField
                  label="Дата ПТО"
                  hint="Дата последнего периодического технического осмотра"
                >
                  <FieldInput
                    type="date"
                    value={form.maintenancePTO || ''}
                    onChange={setStr('maintenancePTO')}
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 5: Примечание ── */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Примечание</h3>
                </div>
                <FormField
                  label="Комментарий"
                  hint="Любая дополнительная информация по технике: история покупки, особенности эксплуатации, ограничения"
                >
                  <textarea
                    value={form.notes || ''}
                    onChange={e => setStr('notes')(e.target.value)}
                    placeholder="Введите произвольный комментарий..."
                    rows={3}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
                  />
                </FormField>
              </div>

            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Поля, отмеченные <span className="text-red-500">*</span>, обязательны
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button onClick={() => onSave(form)}>Сохранить изменения</Button>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
