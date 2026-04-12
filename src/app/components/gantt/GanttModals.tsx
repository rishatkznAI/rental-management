import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RotateCcw, CirclePause as PauseCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { GanttRentalData } from '../../mock-data';
import type { SystemUser } from '../../lib/userStorage';
import type { Client, Equipment } from '../../types';
import { equipmentService } from '../../services/equipment.service';
import { clientsService } from '../../services/clients.service';
import { rentalsService } from '../../services/rentals.service';
import { usersService } from '../../services/users.service';
import { EQUIPMENT_KEYS } from '../../hooks/useEquipment';
import { RENTAL_KEYS } from '../../hooks/useRentals';
import { canEquipmentParticipateInRentals } from '../../lib/equipmentClassification';
import { calculateRentalAmount, formatCurrency, getRentalDays } from '../../lib/utils';
import { EquipmentCombobox } from '../ui/EquipmentCombobox';

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
  invNumber: string,
  startDate: string,
  endDate: string,
  rentals: GanttRentalData[],
): boolean {
  if (!startDate || !endDate) return false;
  const newStart = new Date(startDate).getTime();
  const newEnd   = new Date(endDate).getTime();
  return rentals.some(r => {
    if (r.equipmentInv !== invNumber) return false;
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
  return `${eq.manufacturer} ${eq.model} · INV ${eq.inventoryNumber} · ${sn} — ${type} — ${loc} — ${stat}`;
}

// ─── selectClass — единый стиль для нативных <select> ──────────────────────
const selectClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm ' +
  'focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] ' +
  'dark:border-gray-600 dark:bg-gray-700 dark:text-white';

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
  onConfirm: (data: { rentalId: string; returnDate: string; result: string }) => void;
}

export function ReturnModal({ open, rental: rentalProp, ganttRentals: ganttRentalsProp, onClose, onConfirm }: ReturnModalProps) {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState<'available' | 'service' | 'downtime'>('available');
  const [selectedRentalId, setSelectedRentalId] = useState('');

  // Сброс при открытии модалки
  React.useEffect(() => {
    if (open) {
      setReturnDate(new Date().toISOString().split('T')[0]);
      setResult('available');
      setSelectedRentalId(rentalProp?.id ?? '');
    }
  }, [open, rentalProp]);

  const { data: fetchedGanttRentals = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
    enabled: !ganttRentalsProp,
  });

  // Список аренд для выбора: только активные и созданные (не возвращённые/закрытые)
  const activeRentals = useMemo(() => {
    const all = ganttRentalsProp ?? fetchedGanttRentals;
    return all.filter(r => r.status === 'active' || r.status === 'created');
  }, [fetchedGanttRentals, ganttRentalsProp]);

  // Определяем рабочую аренду: переданная через props ИЛИ выбранная в дропдауне
  const rental = rentalProp ?? activeRentals.find(r => r.id === selectedRentalId) ?? null;

  // Показываем дропдаун выбора только если аренда не передана через props
  const showPicker = !rentalProp;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-[--color-primary]" />
            <h3 className="text-lg text-gray-900 dark:text-white">Возврат техники</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">

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
            <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
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
                {rental.status === 'active' ? 'Активна' : 'Создана'}
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
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50">
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

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                if (!rental) return;
                onConfirm({ rentalId: rental.id, returnDate, result });
              }}
              disabled={!rental}
            >
              Подтвердить возврат
            </Button>
            <Button variant="secondary" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Downtime Modal ===================================================
interface DowntimeModalProps {
  open: boolean;
  preselectedEquipment?: string;
  onClose: () => void;
  onConfirm: (data: { equipmentInv: string; startDate: string; endDate: string; reason: string }) => void;
}

export function DowntimeModal({ open, preselectedEquipment, onClose, onConfirm }: DowntimeModalProps) {
  const [equipmentInv, setEquipmentInv] = useState(preselectedEquipment || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate,   setEndDate]   = useState('');
  const [reason, setReason]       = useState('');

  const { data: equipmentData = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });

  // Подгружаем реестр техники (всё, кроме списанного)
  const allEquipment = useMemo(() =>
    equipmentData.filter(e => e.status !== 'inactive'),
  [equipmentData]);

  React.useEffect(() => {
    if (preselectedEquipment) setEquipmentInv(preselectedEquipment);
  }, [preselectedEquipment]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg text-gray-900 dark:text-white">Отметить простой</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Техника</label>
            {allEquipment.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
                Нет техники в реестре
              </p>
            ) : (
              <EquipmentCombobox
                equipment={allEquipment}
                value={equipmentInv}
                valueKey="inventoryNumber"
                onChange={setEquipmentInv}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="flex gap-3 pt-2">
            <Button onClick={() => onConfirm({ equipmentInv, startDate, endDate, reason })}>
              Сохранить простой
            </Button>
            <Button variant="secondary" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== New Rental Modal =================================================
interface NewRentalModalProps {
  open: boolean;
  preselectedEquipment?: string;
  /** Текущий список аренд из React-состояния родителя.
   *  Передаётся, чтобы модалка и значок статуса техники
   *  использовали один и тот же источник данных. */
  ganttRentals?: GanttRentalData[];
  /** Текущий список техники из React-состояния родителя. */
  equipmentList?: Equipment[];
  clients?: Client[];
  managers?: SystemUser[];
  onClose: () => void;
  onConfirm: (data: {
    client: string;
    equipmentInv: string;
    startDate: string;
    endDate: string;
    manager: string;
    amount: number;
  }) => void;
}

export function NewRentalModal({
  open,
  preselectedEquipment,
  ganttRentals: ganttRentalsProp,
  equipmentList: equipmentListProp,
  clients: clientsProp,
  managers: managersProp,
  onClose,
  onConfirm,
}: NewRentalModalProps) {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client,       setClient]       = useState('');
  const [equipmentInv, setEquipmentInv] = useState(preselectedEquipment || '');
  const [startDate,    setStartDate]    = useState(today);
  const [endDate,      setEndDate]      = useState(nextWeek);
  const [manager,      setManager]      = useState('');
  const [dailyRate,    setDailyRate]    = useState('');
  const [conflictWarn, setConflictWarn] = useState(false);

  React.useEffect(() => {
    if (preselectedEquipment) setEquipmentInv(preselectedEquipment);
  }, [preselectedEquipment]);

  React.useEffect(() => {
    if (!open) return;
    setDailyRate('');
  }, [open]);

  const { data: clientsData = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsService.getAll,
    enabled: !clientsProp,
  });
  const { data: usersData = [] } = useQuery<SystemUser[]>({
    queryKey: ['users'],
    queryFn: usersService.getAll,
    enabled: !managersProp,
  });
  const { data: fetchedGanttRentals = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
    enabled: !ganttRentalsProp,
  });
  const { data: fetchedEquipment = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
    enabled: !equipmentListProp,
  });

  // ─── Данные из справочников ────────────────────────────────────────────────
  const allClients = useMemo(() => clientsProp ?? clientsData, [clientsData, clientsProp]);

  const managers = useMemo(() =>
    (managersProp ?? usersData).filter(u => u.status === 'Активен'),
  [managersProp, usersData]);

  // Единый источник данных: сначала берём из пропса (React-состояние родителя),
  // иначе читаем из API.
  const existingRentals = useMemo(
    () => ganttRentalsProp ?? fetchedGanttRentals,
    [fetchedGanttRentals, ganttRentalsProp],
  );

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
      if (isEquipmentBusy(eq.inventoryNumber, startDate, endDate, existingRentals)) {
        busy.push(eq);
      } else {
        available.push(eq);
      }
    });
    return { availableEquipment: available, busyEquipment: busy };
  }, [startDate, endDate, existingRentals, equipmentListProp, fetchedEquipment]);

  // Проверяем конфликт при выборе техники
  const handleEquipmentChange = (inv: string) => {
    setEquipmentInv(inv);
    const isBusy = busyEquipment.some(e => e.inventoryNumber === inv);
    setConflictWarn(isBusy);
  };

  // Перепроверяем конфликт при смене дат
  React.useEffect(() => {
    if (!equipmentInv) { setConflictWarn(false); return; }
    setConflictWarn(isEquipmentBusy(equipmentInv, startDate, endDate, existingRentals));
  }, [startDate, endDate, equipmentInv, existingRentals]);

  // Находим конкретную аренду, вызывающую конфликт (для отображения деталей)
  const conflictingRental = useMemo(() => {
    if (!conflictWarn || !equipmentInv) return null;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    return existingRentals.find(r => {
      if (r.equipmentInv !== equipmentInv) return false;
      if (r.status === 'returned' || r.status === 'closed') return false;
      return s <= new Date(r.endDate).getTime() && e >= new Date(r.startDate).getTime();
    }) ?? null;
  }, [conflictWarn, equipmentInv, startDate, endDate, existingRentals]);

  const rentalDays = useMemo(() => getRentalDays(startDate, endDate), [startDate, endDate]);
  const totalAmount = useMemo(
    () => calculateRentalAmount(Number(dailyRate) || 0, startDate, endDate),
    [dailyRate, startDate, endDate],
  );

  if (!open) return null;

  const hasNoEquipment = availableEquipment.length === 0 && busyEquipment.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Новая аренда</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">

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
              <select value={client} onChange={e => setClient(e.target.value)} className={selectClass}>
                <option value="">Выберите клиента</option>
                {allClients.map(c => (
                  <option key={c.id} value={c.company}>
                    {c.company}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Даты — перед выбором техники, чтобы сразу проверить доступность */}
          <div className="grid grid-cols-2 gap-3">
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
                  value={equipmentInv}
                  valueKey="inventoryNumber"
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
              <div className="mt-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
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
          <div className="grid grid-cols-2 gap-3">
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

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/50">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">
                {rentalDays > 0 ? `Итого за ${rentalDays} дн.` : 'Итого'}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                onConfirm({ client, equipmentInv, startDate, endDate, manager, amount: totalAmount });
                onClose();
              }}
              disabled={!client || !equipmentInv || !startDate || !endDate}
            >
              Создать аренду
            </Button>
            <Button variant="secondary" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
