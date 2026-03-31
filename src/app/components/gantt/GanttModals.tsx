import React, { useState, useMemo } from 'react';
import { X, RotateCcw, CirclePause as PauseCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { GanttRentalData } from '../../mock-data';
import {
  loadEquipment,
  loadClients,
  loadGanttRentals,
} from '../../mock-data';
import { loadUsers } from '../../pages/Settings';
import type { Equipment } from '../../types';

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
  return `${eq.inventoryNumber} ${eq.model} — ${type} — ${loc} — ${stat}`;
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
  rental?: GanttRentalData | null;
  onClose: () => void;
  onConfirm: (data: { rentalId: string; returnDate: string; result: string }) => void;
}

export function ReturnModal({ open, rental, onClose, onConfirm }: ReturnModalProps) {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState<'available' | 'service' | 'downtime'>('available');

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

        {rental && (
          <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
            <div className="text-gray-500">Аренда</div>
            <div className="text-gray-900 dark:text-white">{rental.id} — {rental.client}</div>
            <div className="text-gray-500">{rental.equipmentInv}</div>
          </div>
        )}

        <div className="space-y-4">
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

          <div className="flex gap-3 pt-2">
            <Button onClick={() => onConfirm({ rentalId: rental?.id || '', returnDate, result })}>
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

  // Подгружаем реестр техники (всё, кроме списанного)
  const allEquipment = useMemo(() =>
    loadEquipment().filter(e => e.status !== 'inactive'),
  []);

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
              <select value={equipmentInv} onChange={(e) => setEquipmentInv(e.target.value)} className={selectClass}>
                <option value="">Выберите технику</option>
                {allEquipment.map((eq) => (
                  <option key={eq.inventoryNumber} value={eq.inventoryNumber}>
                    {equipmentOptionLabel(eq)}
                  </option>
                ))}
              </select>
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
  onClose: () => void;
  onConfirm: (data: {
    client: string;
    equipmentInv: string;
    startDate: string;
    endDate: string;
    manager: string;
    amount: string;
  }) => void;
}

export function NewRentalModal({ open, preselectedEquipment, onClose, onConfirm }: NewRentalModalProps) {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client,       setClient]       = useState('');
  const [equipmentInv, setEquipmentInv] = useState(preselectedEquipment || '');
  const [startDate,    setStartDate]    = useState(today);
  const [endDate,      setEndDate]      = useState(nextWeek);
  const [manager,      setManager]      = useState('');
  const [amount,       setAmount]       = useState('');
  const [conflictWarn, setConflictWarn] = useState(false);

  React.useEffect(() => {
    if (preselectedEquipment) setEquipmentInv(preselectedEquipment);
  }, [preselectedEquipment]);

  // ─── Данные из справочников ────────────────────────────────────────────────
  const allClients = useMemo(() => loadClients(), []);

  const managers = useMemo(() =>
    loadUsers().filter(u => u.status === 'Активен'),
  []);

  const existingRentals = useMemo(() => loadGanttRentals(), []);

  /**
   * Фильтрация техники:
   * - исключаем списанную (inactive) и в сервисе (in_service)
   * - проверяем конфликт по датам аренды
   */
  const { availableEquipment, busyEquipment } = useMemo(() => {
    const all = loadEquipment().filter(e =>
      e.status !== 'inactive' && e.status !== 'in_service',
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
  }, [startDate, endDate, existingRentals]);

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
            ) : availableEquipment.length === 0 ? (
              <p className="rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-600 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                Нет доступной техники на выбранный период
              </p>
            ) : (
              <>
                <select
                  value={equipmentInv}
                  onChange={e => handleEquipmentChange(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Выберите технику</option>
                  {/* Свободная техника */}
                  {availableEquipment.length > 0 && (
                    <optgroup label="✓ Доступна на выбранный период">
                      {availableEquipment.map(eq => (
                        <option key={eq.inventoryNumber} value={eq.inventoryNumber}>
                          {equipmentOptionLabel(eq)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {/* Занятая (предупреждение) */}
                  {busyEquipment.length > 0 && (
                    <optgroup label="⚠ Занята на выбранный период">
                      {busyEquipment.map(eq => (
                        <option key={eq.inventoryNumber} value={eq.inventoryNumber}>
                          {equipmentOptionLabel(eq)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </>
            )}

            {/* Предупреждение о конфликте */}
            {conflictWarn && (
              <p className="mt-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                ⚠ Техника уже занята на выбранный период. Аренды будут пересекаться.
              </p>
            )}
          </div>

          {/* Менеджер + Сумма */}
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
              label="Сумма (₽)"
              type="number"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                onConfirm({ client, equipmentInv, startDate, endDate, manager, amount });
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
