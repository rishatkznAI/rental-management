import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RotateCcw, CirclePause as PauseCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { DowntimePeriod, GanttRentalData } from '../../mock-data';
import { filterRentalManagerUsers } from '../../lib/userStorage';
import type { Client, ClientContract, ClientObject, Equipment } from '../../types';
import { equipmentService } from '../../services/equipment.service';
import { clientsService } from '../../services/clients.service';
import { clientContractsService } from '../../services/client-contracts.service';
import { clientObjectsService } from '../../services/client-objects.service';
import { paymentsService } from '../../services/payments.service';
import { rentalsService } from '../../services/rentals.service';
import { staffService, type StaffOption } from '../../services/staff.service';
import { EQUIPMENT_KEYS } from '../../hooks/useEquipment';
import { RENTAL_KEYS } from '../../hooks/useRentals';
import { canEquipmentParticipateInRentals } from '../../lib/equipmentClassification';
import { calculateRentalAmount, formatCurrency, getRentalDays } from '../../lib/utils';
import { buildClientFinancialSnapshots } from '../../lib/finance';
import { EquipmentCombobox } from '../ui/EquipmentCombobox';
import { ClientCombobox } from '../ui/ClientCombobox';
import { animationDurations, useAnimatedPresence } from '../../lib/animations';

// ─── Локальные хелперы ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  scissor:     'Ножничный',
  articulated: 'Коленчатый',
  telescopic:  'Телескопический',
};

const LOCATION_LABELS: Record<string, string> = {
  moscow_sklad_a: 'Москва — Склад А',
  moscow_sklad_b: 'Москва — Склад Б',
  spb_sklad_1:    'СПб — Склад 1',
  kazan_sklad_1:  'Казань — Склад 1',
  ekb_sklad_1:    'Екб — Склад 1',
  at_client:      'У клиента',
  at_service:     'В сервисе',
};

const STATUS_LABELS: Record<string, string> = {
  available:  'Свободна',
  rented:     'В аренде',
  reserved:   'Бронь',
  in_service: 'В сервисе',
  inactive:   'Списана',
};

/** Проверяет, занята ли техника (в аренде) на заданный период */
function isEquipmentBusy(
  equipment: Equipment,
  startDate: string,
  endDate: string,
  rentals: GanttRentalData[],
  allowInventoryFallback = true,
): boolean {
  if (!startDate || !endDate) return false;
  const newStart = new Date(startDate).getTime();
  const newEnd   = new Date(endDate).getTime();
  return rentals.some(r => {
    const matchesEquipment = r.equipmentId
      ? r.equipmentId === equipment.id
      : allowInventoryFallback && r.equipmentInv === equipment.inventoryNumber;
    if (!matchesEquipment) return false;
    if (r.status === 'returned' || r.status === 'closed') return false;
    const rStart = new Date(r.startDate).getTime();
    const rEnd   = new Date(r.endDate).getTime();
    return newStart <= rEnd && newEnd >= rStart; // перекрытие
  });
}

/** Формирует читаемую строку для опции техники */
function equipmentOptionLabel(eq: Equipment): string {
  const type = TYPE_LABELS[eq.type] ?? eq.type;
  const loc  = LOCATION_LABELS[eq.location] ?? eq.location ?? '—';
  const stat = STATUS_LABELS[eq.status] ?? eq.status;
  const sn   = eq.serialNumber ? `SN ${eq.serialNumber}` : 'SN не указан';
  return `${eq.manufacturer} ${eq.model} · ${sn} · INV ${eq.inventoryNumber || 'не указан'} — ${type} — ${loc} — ${stat}`;
}

// ─── selectClass — единый стиль для нативных <select> ──────────────────────
const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm ' +
  'focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-blue-400';

const modalOverlayClass = 'app-animate-overlay absolute inset-0 bg-slate-950/45 backdrop-blur-[3px] dark:bg-black/60';
const modalSurfaceClass = 'app-animate-modal fixed left-1/2 top-1/2 z-10 flex max-h-[min(92dvh,calc(100dvh-2rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 shadow-[0_32px_90px_-46px_rgba(15,23,42,0.72)] dark:border-gray-800 dark:bg-gray-950 dark:shadow-2xl';
const modalHeaderClass = 'flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 pr-14 dark:border-gray-800';
const modalBodyClass = 'min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5';
const modalFooterClass = 'sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:justify-end dark:border-gray-800 dark:bg-gray-950/95';
const modalCloseClass = 'absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200';

function getGanttRentalSourceId(rental: GanttRentalData): string {
  return String(
    rental.rentalId ||
    rental.sourceRentalId ||
    rental.originalRentalId ||
    ''
  ).trim();
}

// ─── LabeledInput — Input с заголовком (Input сам по себе не рендерит label) ─
function LabeledInput({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <Input {...props} />
    </div>
  );
}

// ========== Return Modal =====================================================
interface ReturnModalProps {
  open: boolean;
  /** Заранее выбранная аренда (при открытии из строки техники).
   *  Если не передана — пользователь выбирает сам из списка активных аренд. */
  rental?: GanttRentalData | null;
  /** Список всех аренд из React-состояния родителя (единый источник истины). */
  ganttRentals?: GanttRentalData[];
  onClose: () => void;
  onConfirm: (data: { rentalId: string; ganttRentalId: string; rental: GanttRentalData; returnDate: string; result: string }) => void;
}

export function ReturnModal({ open, rental: rentalProp, ganttRentals: ganttRentalsProp, onClose, onConfirm }: ReturnModalProps) {
  const presence = useAnimatedPresence(open, animationDurations.base);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState<'available' | 'service' | 'downtime'>('available');
  const [selectedRentalId, setSelectedRentalId] = useState('');
  const showPicker = !rentalProp;

  // Сброс при открытии модалки
  React.useEffect(() => {
    if (open) {
      setReturnDate(new Date().toISOString().split('T')[0]);
      setResult('available');
      setSelectedRentalId(rentalProp?.id ?? '');
    }
  }, [open, rentalProp]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  const { data: fetchedGanttRentals = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
    enabled: open && showPicker,
  });

  // Список аренд для выбора: объединяем локальный state и свежий query,
  // чтобы только что созданные записи не пропадали из модалки из-за stale-снимка.
  const activeRentals = useMemo(() => {
    const merged = new Map<string, GanttRentalData>();
    fetchedGanttRentals.forEach(rental => {
      merged.set(rental.id, rental);
    });
    (ganttRentalsProp ?? []).forEach(rental => {
      merged.set(rental.id, rental);
    });
    return Array.from(merged.values()).filter(r => r.status === 'active' || r.status === 'created');
  }, [fetchedGanttRentals, ganttRentalsProp]);

  // Определяем рабочую аренду: переданная через props ИЛИ выбранная в дропдауне
  const rental = rentalProp ?? activeRentals.find(r => r.id === selectedRentalId) ?? null;

  if (!presence.shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div data-state={presence.dataState} className={modalOverlayClass} onClick={onClose} />
      <div data-state={presence.dataState} onAnimationEnd={presence.onExitAnimationEnd} className={`${modalSurfaceClass} max-w-md`}>
        <div className={modalHeaderClass}>
          <div className="flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <RotateCcw className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-xl font-semibold text-slate-950 dark:text-white">Возврат техники</h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-gray-400">Зафиксируйте дату и состояние техники после возврата.</p>
            </div>
          </div>
          <button onClick={onClose} className={modalCloseClass}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={modalBodyClass}>

          {/* Выбор аренды — только когда аренда не передана заранее */}
          {showPicker && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Активная аренда
              </label>
              {activeRentals.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
                  Нет активных аренд для возврата
                </p>
              ) : (
                <select
                  value={selectedRentalId}
                  onChange={e => setSelectedRentalId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Выберите аренду</option>
                  {activeRentals.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.id} — {r.client} — {r.equipmentInv} ({r.startDate} → {r.endDate})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Карточка выбранной аренды */}
          {rental && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900/60">
              <div className="mb-1 text-xs text-gray-500">Аренда</div>
              <div className="font-medium text-gray-900 dark:text-white">
                {rental.id} — {rental.client}
              </div>
              <div className="text-gray-600 dark:text-gray-400">
                {rental.equipmentInv} · {rental.startDate} — {rental.endDate}
              </div>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                rental.status === 'active'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {rental.status === 'active' ? 'Активна' : 'Бронь'}
              </span>
            </div>
          )}

          {/* Дата и результат — только когда выбрана аренда или есть активные */}
          {(rental !== null || activeRentals.length > 0) && (
            <>
              <LabeledInput
                label="Дата возврата"
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />

              <div>
                <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Результат возврата</label>
                <div className="space-y-2">
                  {[
                    { value: 'available', label: 'Техника свободна' },
                    { value: 'service',   label: 'Отправить в сервис' },
                    { value: 'downtime',  label: 'Простой' },
                  ].map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900/60 dark:hover:bg-gray-900">
                      <input
                        type="radio"
                        name="result"
                        value={opt.value}
                        checked={result === opt.value}
                        onChange={() => setResult(opt.value as typeof result)}
                        className="h-4 w-4 text-[--color-primary]"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

          <div className={modalFooterClass}>
            <Button variant="secondary" onClick={onClose}>Отмена</Button>
            <Button
              onClick={() => {
                if (!rental) return;
                onConfirm({
                  rentalId: getGanttRentalSourceId(rental),
                  ganttRentalId: rental.id,
                  rental,
                  returnDate,
                  result,
                });
              }}
              disabled={!rental}
            >
              Подтвердить возврат
            </Button>
          </div>
      </div>
    </div>
  );
}

// ========== Downtime Modal ===================================================
interface DowntimeModalProps {
  open: boolean;
  downtime?: DowntimePeriod | null;
  preselectedEquipmentId?: string;
  preselectedEquipmentInv?: string;
  onClose: () => void;
  onConfirm: (data: {
    id?: string;
    equipmentId: string;
    equipmentInv: string;
    serialNumber?: string;
    startDate: string;
    endDate?: string;
    reason: string;
    comment?: string;
    affectsBilling?: boolean;
    status: 'active' | 'closed' | 'cancelled';
  }) => void;
}

export function DowntimeModal({
  open,
  downtime,
  preselectedEquipmentId,
  preselectedEquipmentInv,
  onClose,
  onConfirm,
}: DowntimeModalProps) {
  const presence = useAnimatedPresence(open, animationDurations.base);
  const today = new Date().toISOString().split('T')[0];
  const [equipmentId, setEquipmentId] = useState(preselectedEquipmentId || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate,   setEndDate]   = useState('');
  const [reason, setReason]       = useState('');
  const [comment, setComment]     = useState('');
  const [affectsBilling, setAffectsBilling] = useState(false);
  const [status, setStatus]       = useState<'active' | 'closed' | 'cancelled'>('active');
  const [formError, setFormError] = useState('');

  const { data: equipmentData = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
    enabled: open,
  });

  // Подгружаем реестр техники (всё, кроме списанного)
  const allEquipment = useMemo(() =>
    equipmentData.filter(e => e.status !== 'inactive'),
  [equipmentData]);

  const selectedEquipment = useMemo(
    () => allEquipment.find(item => item.id === equipmentId) ?? null,
    [allEquipment, equipmentId],
  );

  React.useEffect(() => {
    if (!open) return;
    const fallbackEquipmentId = preselectedEquipmentInv
      ? allEquipment.find(item => item.inventoryNumber === preselectedEquipmentInv)?.id || ''
      : '';
    setEquipmentId(downtime?.equipmentId || preselectedEquipmentId || fallbackEquipmentId || '');
    setStartDate(downtime?.startDate || today);
    setEndDate(downtime?.endDate || '');
    setReason(downtime?.reason || '');
    setComment(downtime?.comment || '');
    setAffectsBilling(downtime?.affectsBilling === true);
    setStatus(downtime?.status || 'active');
    setFormError('');
  }, [allEquipment, downtime, open, preselectedEquipmentId, preselectedEquipmentInv, today]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!presence.shouldRender) return null;

  const isEditing = Boolean(downtime?.id);
  const submit = (nextStatus: 'active' | 'closed' | 'cancelled' = status) => {
    const nextEndDate = nextStatus === 'closed' && !endDate
      ? (startDate && today < startDate ? startDate : today)
      : endDate;
    const equipmentInv = selectedEquipment?.inventoryNumber || downtime?.equipmentInv || preselectedEquipmentInv || '';
    const serialNumber = selectedEquipment?.serialNumber || downtime?.serialNumber || '';

    if (!equipmentId && !serialNumber && !equipmentInv) {
      setFormError('Выберите технику для простоя.');
      return;
    }
    if (!startDate) {
      setFormError('Укажите дату начала простоя.');
      return;
    }
    if (!nextEndDate) {
      setFormError('Укажите дату окончания простоя.');
      return;
    }
    if (nextEndDate < startDate) {
      setFormError('Дата окончания простоя не может быть раньше даты начала.');
      return;
    }
    if (!reason.trim()) {
      setFormError('Укажите причину простоя.');
      return;
    }

    setFormError('');
    onConfirm({
      id: downtime?.id,
      equipmentId,
      equipmentInv,
      serialNumber,
      startDate,
      endDate: nextEndDate,
      reason,
      comment,
      affectsBilling,
      status: nextStatus,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div data-state={presence.dataState} className={modalOverlayClass} onClick={onClose} />
      <div data-state={presence.dataState} onAnimationEnd={presence.onExitAnimationEnd} className={`${modalSurfaceClass} max-w-md`}>
        <div className={modalHeaderClass}>
          <div className="flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
              <PauseCircle className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-xl font-semibold text-slate-950 dark:text-white">{isEditing ? 'Изменить простой' : 'Добавить простой'}</h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-gray-400">Укажите технику, период, причину и комментарий.</p>
            </div>
          </div>
          <button onClick={onClose} className={modalCloseClass}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={modalBodyClass}>
          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Техника</label>
            {allEquipment.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
                Нет техники в реестре
              </p>
            ) : (
              <EquipmentCombobox
                equipment={allEquipment}
                value={equipmentId}
                valueKey="id"
                onChange={setEquipmentId}
              />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput label="Начало"    type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <LabeledInput label="Окончание" type="date" value={endDate}   onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Причина</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={selectClass}>
              <option value="">Не указана</option>
              <option value="Нет спроса">Нет спроса</option>
              <option value="Ожидание ремонта">Ожидание ремонта</option>
              <option value="Ожидание клиента">Ожидание клиента</option>
              <option value="Другое">Другое</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Комментарий</label>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что важно знать по этому простою"
            />
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
            <input
              type="checkbox"
              checked={affectsBilling}
              onChange={(event) => setAffectsBilling(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span>
              <span className="block font-medium">Влияет на начисление</span>
              <span className="block text-xs text-amber-700 dark:text-amber-300">Если включено, дни простоя будут вычитаться из дней к начислению.</span>
            </span>
          </label>

          {isEditing && (
            <div>
              <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Статус</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'closed' | 'cancelled')} className={selectClass}>
                <option value="active">Активен</option>
                <option value="closed">Закрыт</option>
                <option value="cancelled">Отменён</option>
              </select>
            </div>
          )}

          {formError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {formError}
            </p>
          )}
        </div>

        <div className={modalFooterClass}>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          {isEditing && status !== 'cancelled' && (
            <Button variant="secondary" onClick={() => submit('cancelled')}>
              Отменить простой
            </Button>
          )}
          {isEditing && status === 'active' && (
            <Button variant="secondary" onClick={() => submit('closed')}>
              Закрыть простой
            </Button>
          )}
          <Button onClick={() => submit(status)}>
            {isEditing ? 'Сохранить изменения' : 'Добавить простой'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ========== New Rental Modal =================================================
interface NewRentalModalProps {
  open: boolean;
  preselectedEquipmentId?: string;
  /** Текущий список аренд из React-состояния родителя.
   *  Передаётся, чтобы модалка и значок статуса техники
   *  использовали один и тот же источник данных. */
  ganttRentals?: GanttRentalData[];
  /** Текущий список техники из React-состояния родителя. */
  equipmentList?: Equipment[];
  clients?: Client[];
  managers?: StaffOption[];
  onClose: () => void;
  onConfirm: (data: {
    clientId: string;
    client: string;
    objectId: string;
    contractId: string;
    equipmentId: string;
    equipmentInv: string;
    startDate: string;
    endDate: string;
    manager: string;
    amount: number;
  }) => void | Promise<void>;
}

export function NewRentalModal({
  open,
  preselectedEquipmentId,
  ganttRentals: ganttRentalsProp,
  equipmentList: equipmentListProp,
  clients: clientsProp,
  managers: managersProp,
  onClose,
  onConfirm,
}: NewRentalModalProps) {
  const presence = useAnimatedPresence(open, animationDurations.base);
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client,       setClient]       = useState('');
  const [clientId,     setClientId]     = useState('');
  const [objectId,     setObjectId]     = useState('');
  const [contractId,   setContractId]   = useState('');
  const [equipmentId,  setEquipmentId]  = useState('');
  const [startDate,    setStartDate]    = useState(today);
  const [endDate,      setEndDate]      = useState(nextWeek);
  const [manager,      setManager]      = useState('');
  const [dailyRate,    setDailyRate]    = useState('');
  const [conflictWarn, setConflictWarn] = useState(false);
  const [submitError,  setSubmitError]  = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDailyRate('');
    setClient('');
    setClientId('');
    setObjectId('');
    setContractId('');
    setManager('');
    setSubmitError('');
    setConflictWarn(false);
    if (!preselectedEquipmentId) setEquipmentId('');
  }, [open, preselectedEquipmentId]);

  const { data: clientsData = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsService.getAll,
    enabled: open && !clientsProp,
  });
  const { data: usersData = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'manager-options'],
    queryFn: staffService.getManagerOptions,
    enabled: open && !managersProp,
  });
  const { data: clientObjectsData = [] } = useQuery<ClientObject[]>({
    queryKey: ['client_objects'],
    queryFn: clientObjectsService.getAll,
    enabled: open,
  });
  const { data: clientContractsData = [] } = useQuery<ClientContract[]>({
    queryKey: ['client_contracts'],
    queryFn: clientContractsService.getAll,
    enabled: open,
  });
  const { data: paymentsData = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: paymentsService.getAll,
    enabled: open,
  });
  const { data: fetchedGanttRentals = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
    enabled: open && !ganttRentalsProp,
  });
  const { data: fetchedEquipment = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
    enabled: open && !equipmentListProp,
  });

  React.useEffect(() => {
    if (!open) return;
    if (!preselectedEquipmentId) return;
    const selected = (equipmentListProp ?? fetchedEquipment).find(item => item.id === preselectedEquipmentId);
    if (selected) setEquipmentId(selected.id);
  }, [open, preselectedEquipmentId, equipmentListProp, fetchedEquipment]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  // ─── Данные из справочников ────────────────────────────────────────────────
  const allClients = useMemo(() => clientsProp ?? clientsData, [clientsData, clientsProp]);

  const managers = useMemo(() =>
    filterRentalManagerUsers(managersProp ?? usersData),
  [managersProp, usersData]);

  // Единый источник данных: сначала берём из пропса (React-состояние родителя),
  // иначе читаем из API.
  const existingRentals = useMemo(
    () => ganttRentalsProp ?? fetchedGanttRentals,
    [fetchedGanttRentals, ganttRentalsProp],
  );
  const clientFinancials = useMemo(
    () => buildClientFinancialSnapshots(allClients, existingRentals, paymentsData),
    [allClients, existingRentals, paymentsData],
  );
  const selectedClientFinancial = useMemo(
    () => clientFinancials.find(item => item.clientId === clientId),
    [clientFinancials, clientId],
  );
  const selectedClient = useMemo(
    () => allClients.find(item => item.id === clientId) ?? null,
    [allClients, clientId],
  );
  const selectedClientObjects = useMemo(
    () => clientObjectsData.filter(item => item.clientId === clientId && item.status !== 'archived'),
    [clientId, clientObjectsData],
  );
  const selectedClientContracts = useMemo(
    () => clientContractsData.filter(item =>
      item.clientId === clientId &&
      item.status !== 'archived' &&
      (!objectId || !item.objectId || item.objectId === objectId)
    ),
    [clientId, clientContractsData, objectId],
  );
  React.useEffect(() => {
    if (!open) return;
    setObjectId('');
    setContractId('');
  }, [clientId, open]);
  React.useEffect(() => {
    if (!open) return;
    if (selectedClientObjects.length === 1 && !objectId) setObjectId(selectedClientObjects[0].id);
  }, [objectId, open, selectedClientObjects]);
  const uniqueInventoryNumbers = useMemo(() => {
    const counts = new Map<string, number>();
    (equipmentListProp ?? fetchedEquipment).forEach(item => {
      if (!item.inventoryNumber) return;
      counts.set(item.inventoryNumber, (counts.get(item.inventoryNumber) || 0) + 1);
    });
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count === 1)
        .map(([inventoryNumber]) => inventoryNumber),
    );
  }, [equipmentListProp, fetchedEquipment]);

  /**
   * Фильтрация техники:
   * - исключаем списанную (inactive) и в сервисе (in_service)
   * - проверяем конфликт по датам аренды
   * Используем список техники из пропса (React-состояние родителя),
   * либо подгружаем его из API.
   */
  const { availableEquipment, busyEquipment } = useMemo(() => {
    const all = (equipmentListProp ?? fetchedEquipment).filter(e =>
      canEquipmentParticipateInRentals(e) && e.status !== 'inactive' && e.status !== 'in_service',
    );
    if (!startDate || !endDate) {
      return { availableEquipment: all, busyEquipment: [] };
    }
    const available: Equipment[] = [];
    const busy: Equipment[] = [];
    all.forEach(eq => {
      if (isEquipmentBusy(eq, startDate, endDate, existingRentals, uniqueInventoryNumbers.has(eq.inventoryNumber))) {
        busy.push(eq);
      } else {
        available.push(eq);
      }
    });
    return { availableEquipment: available, busyEquipment: busy };
  }, [startDate, endDate, existingRentals, equipmentListProp, fetchedEquipment, uniqueInventoryNumbers]);

  const selectedEquipment = useMemo(
    () => [...availableEquipment, ...busyEquipment].find(eq => eq.id === equipmentId)
      || (equipmentListProp ?? fetchedEquipment).find(eq => eq.id === equipmentId)
      || null,
    [availableEquipment, busyEquipment, equipmentId, equipmentListProp, fetchedEquipment],
  );

  // Проверяем конфликт при выборе техники
  const handleEquipmentChange = (id: string) => {
    setEquipmentId(id);
    const isBusy = busyEquipment.some(e => e.id === id);
    setConflictWarn(isBusy);
  };

  // Перепроверяем конфликт при смене дат
  React.useEffect(() => {
    if (!open) return;
    if (!selectedEquipment) { setConflictWarn(false); return; }
    setConflictWarn(
      isEquipmentBusy(
        selectedEquipment,
        startDate,
        endDate,
        existingRentals,
        uniqueInventoryNumbers.has(selectedEquipment.inventoryNumber),
      ),
    );
  }, [open, startDate, endDate, selectedEquipment, existingRentals, uniqueInventoryNumbers]);

  // Находим конкретную аренду, вызывающую конфликт (для отображения деталей)
  const conflictingRental = useMemo(() => {
    if (!conflictWarn || !selectedEquipment) return null;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    return existingRentals.find(r => {
      const matchesEquipment = r.equipmentId
        ? r.equipmentId === selectedEquipment.id
        : uniqueInventoryNumbers.has(selectedEquipment.inventoryNumber) && r.equipmentInv === selectedEquipment.inventoryNumber;
      if (!matchesEquipment) return false;
      if (r.status === 'returned' || r.status === 'closed') return false;
      return s <= new Date(r.endDate).getTime() && e >= new Date(r.startDate).getTime();
    }) ?? null;
  }, [conflictWarn, selectedEquipment, startDate, endDate, existingRentals, uniqueInventoryNumbers]);

  const rentalDays = useMemo(() => getRentalDays(startDate, endDate), [startDate, endDate]);
  const totalAmount = useMemo(
    () => calculateRentalAmount(Number(dailyRate) || 0, startDate, endDate),
    [dailyRate, startDate, endDate],
  );

  if (!presence.shouldRender) return null;

  const hasNoEquipment = availableEquipment.length === 0 && busyEquipment.length === 0;

  const submit = async () => {
    setSubmitError('');
    if (!selectedClient) {
      setSubmitError('Выберите клиента.');
      return;
    }
    if (!selectedEquipment) {
      setSubmitError('Выберите технику.');
      return;
    }
    if (!startDate || !endDate) {
      setSubmitError('Укажите даты начала и окончания аренды.');
      return;
    }
    if (!objectId || !contractId) {
      setSubmitError('Для аренды укажите объект клиента и договор.');
      return;
    }
    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      setSubmitError('Дата окончания аренды не может быть раньше даты начала.');
      return;
    }
    if (conflictWarn) {
      setSubmitError('Техника занята на выбранный период. Выберите другие даты или другую технику.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onConfirm({
        clientId: selectedClient.id,
        client: selectedClient.company,
        objectId,
        contractId,
        equipmentId: selectedEquipment.id,
        equipmentInv: selectedEquipment.inventoryNumber,
        startDate,
        endDate,
        manager,
        amount: totalAmount,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Не удалось создать аренду.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div data-state={presence.dataState} className={modalOverlayClass} onClick={onClose} />
      <div data-state={presence.dataState} onAnimationEnd={presence.onExitAnimationEnd} className={`${modalSurfaceClass} max-w-lg`}>
        <div className={modalHeaderClass}>
          <div>
            <h3 className="text-xl font-semibold text-slate-950 dark:text-white">Новая аренда</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">Выберите клиента, период, технику и коммерческие условия.</p>
          </div>
          <button onClick={onClose} className={modalCloseClass}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={modalBodyClass}>

          {/* Клиент */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Клиент
            </label>
            {allClients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
                Клиентов нет — добавьте в разделе «Клиенты»
              </p>
            ) : (
              <ClientCombobox
                clients={allClients}
                value={client}
                valueId={clientId}
                onChange={setClient}
                onClientSelect={(selected) => {
                  setClientId(selected?.id ?? '');
                  setClient(selected?.company ?? '');
                }}
                placeholder="Введите клиента и выберите из базы…"
              />
            )}
          </div>

          {clientId && selectedClientFinancial && (
            <div className={`rounded-2xl border px-3 py-3 text-sm ${
              selectedClientFinancial.exceededLimit || selectedClientFinancial.overdueRentals > 0
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
                : selectedClientFinancial.currentDebt > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                  : 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {selectedClientFinancial.overdueRentals > 0
                      ? 'Внимание: у клиента есть просроченная задолженность'
                      : selectedClientFinancial.exceededLimit
                      ? 'Внимание: кредитный лимит клиента превышен'
                      : selectedClientFinancial.currentDebt > 0
                        ? 'У клиента есть задолженность'
                        : 'У клиента нет активной задолженности'}
                  </p>
                  <p className="mt-1 text-xs opacity-90">
                    Неоплаченных аренд: {selectedClientFinancial.unpaidRentals}
                    {selectedClientFinancial.overdueRentals > 0 && ` · просроченных: ${selectedClientFinancial.overdueRentals}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide opacity-75">Долг</p>
                  <p className="text-base font-semibold">{formatCurrency(selectedClientFinancial.currentDebt)}</p>
                </div>
              </div>
            </div>
          )}

          {selectedClient && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Объект <span className="text-red-500">*</span>
                </label>
                {selectedClientObjects.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400 dark:border-gray-600">
                    У клиента нет активных объектов
                  </p>
                ) : (
                  <select
                    value={objectId}
                    onChange={event => {
                      setObjectId(event.target.value);
                      setContractId('');
                    }}
                    className={selectClass}
                  >
                    <option value="">Выберите</option>
                    {selectedClientObjects.map(object => (
                      <option key={object.id} value={object.id}>{object.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Договор <span className="text-red-500">*</span>
                </label>
                <select value={contractId} onChange={event => setContractId(event.target.value)} className={selectClass}>
                  <option value="">Выберите</option>
                  {selectedClientContracts.map(contract => (
                    <option key={contract.id} value={contract.id}>{contract.number}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Даты — перед выбором техники, чтобы сразу проверить доступность */}
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput
              label="Дата начала"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
            <LabeledInput
              label="Дата окончания"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>

          {/* Техника */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Техника
            </label>

            {hasNoEquipment ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
                Сначала добавьте технику в реестр (раздел «Техника»)
              </p>
            ) : (
              <>
                {/* Предупреждение когда вся техника занята */}
                {availableEquipment.length === 0 && (
                  <p className="mb-2 rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-600 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                    Нет свободной техники на выбранный период — выберите единицу ниже, чтобы узнать какая аренда блокирует
                  </p>
                )}
                <EquipmentCombobox
                  equipment={[...availableEquipment, ...busyEquipment]}
                  value={equipmentId}
                  valueKey="id"
                  onChange={handleEquipmentChange}
                  groups={[
                    ...(availableEquipment.length > 0
                      ? [{ label: '✓ Доступна на выбранный период', items: availableEquipment }]
                      : []),
                    ...(busyEquipment.length > 0
                      ? [{ label: '⚠ Занята на выбранный период', items: busyEquipment }]
                      : []),
                  ]}
                />
              </>
            )}

            {/* Предупреждение о конфликте с деталями */}
            {conflictWarn && (
              <div className="mt-2 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                <p className="font-medium">⚠ Техника занята на выбранный период</p>
                {conflictingRental ? (
                  <>
                    <p className="mt-1 font-mono text-[11px] text-orange-800 dark:text-orange-200">
                      {conflictingRental.id} · {conflictingRental.client} · {conflictingRental.startDate} — {conflictingRental.endDate} · {conflictingRental.status}
                    </p>
                    {conflictingRental.status === 'created' && (
                      <p className="mt-1 text-orange-600 dark:text-orange-300">
                        💡 Это аренда со статусом «создана» — если она тестовая, найдите её в планировщике (кликните на полосу аренды) и удалите через меню.
                      </p>
                    )}
                    {conflictingRental.status === 'active' && (
                      <p className="mt-1 text-orange-600 dark:text-orange-300">
                        Техника в активной аренде. Выберите другие даты или другую технику.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5">Выберите другие даты или другую технику.</p>
                )}
              </div>
            )}
          </div>

          {/* Менеджер + Дневная ставка */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Менеджер
              </label>
              <select value={manager} onChange={e => setManager(e.target.value)} className={selectClass}>
                <option value="">Выберите</option>
                {managers.map(u => (
                  <option key={u.id} value={u.name}>{u.name}</option>
                ))}
              </select>
            </div>
            <LabeledInput
              label="Ставка в день (₽)"
              type="number"
              placeholder="0"
              value={dailyRate}
              onChange={e => setDailyRate(e.target.value)}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900/60">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">
                {rentalDays > 0 ? `Итого за ${rentalDays} дн.` : 'Итого'}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {submitError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {submitError}
            </div>
          )}

        </div>

        <div className={modalFooterClass}>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => { void submit(); }}
            disabled={isSubmitting || !selectedClient || !objectId || !contractId || !selectedEquipment || !startDate || !endDate || conflictWarn}
          >
            {isSubmitting ? 'Создание…' : 'Создать аренду'}
          </Button>
        </div>
      </div>
    </div>
  );
}
