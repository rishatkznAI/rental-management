import React, { useState } from 'react';
import { X, RotateCcw, CirclePause as PauseCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { GanttRentalData } from '../../mock-data';
import { mockEquipment } from '../../mock-data';

// ========== Return Modal ==========
interface ReturnModalProps {
  open: boolean;
  rental?: GanttRentalData | null;
  onClose: () => void;
  onConfirm: (data: { rentalId: string; returnDate: string; result: string }) => void;
}

export function ReturnModal({ open, rental, onClose, onConfirm }: ReturnModalProps) {
  const [returnDate, setReturnDate] = useState('2026-03-03');
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
          <Input
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
                { value: 'service', label: 'Отправить в сервис' },
                { value: 'downtime', label: 'Простой' },
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

// ========== Downtime Modal ==========
interface DowntimeModalProps {
  open: boolean;
  preselectedEquipment?: string;
  onClose: () => void;
  onConfirm: (data: { equipmentInv: string; startDate: string; endDate: string; reason: string }) => void;
}

export function DowntimeModal({ open, preselectedEquipment, onClose, onConfirm }: DowntimeModalProps) {
  const [equipmentInv, setEquipmentInv] = useState(preselectedEquipment || '');
  const [startDate, setStartDate] = useState('2026-03-03');
  const [endDate, setEndDate] = useState('2026-03-10');
  const [reason, setReason] = useState('');

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
            <select
              value={equipmentInv}
              onChange={(e) => setEquipmentInv(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Выберите технику</option>
              {mockEquipment.map((eq) => (
                <option key={eq.inventoryNumber} value={eq.inventoryNumber}>
                  {eq.inventoryNumber} — {eq.model}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Начало"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="Окончание"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Причина</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
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

// ========== New Rental Modal ==========
interface NewRentalModalProps {
  open: boolean;
  preselectedEquipment?: string;
  onClose: () => void;
  onConfirm: (data: any) => void;
}

export function NewRentalModal({ open, preselectedEquipment, onClose, onConfirm }: NewRentalModalProps) {
  const [client, setClient] = useState('');
  const [equipmentInv, setEquipmentInv] = useState(preselectedEquipment || '');
  const [startDate, setStartDate] = useState('2026-03-03');
  const [endDate, setEndDate] = useState('2026-03-10');
  const [manager, setManager] = useState('');
  const [amount, setAmount] = useState('');

  React.useEffect(() => {
    if (preselectedEquipment) setEquipmentInv(preselectedEquipment);
  }, [preselectedEquipment]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg text-gray-900 dark:text-white">Новая аренда</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Клиент</label>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Выберите клиента</option>
              <option value="ООО СтройМастер">ООО СтройМастер</option>
              <option value="ИП Петров А.В.">ИП Петров А.В.</option>
              <option value="ООО Технострой">ООО Технострой</option>
              <option value="АО РемМонтаж">АО РемМонтаж</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Техника</label>
            <select
              value={equipmentInv}
              onChange={(e) => setEquipmentInv(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Выберите технику</option>
              {mockEquipment.map((eq) => (
                <option key={eq.inventoryNumber} value={eq.inventoryNumber}>
                  {eq.inventoryNumber} — {eq.model}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Дата начала"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="Дата окончания"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">Менеджер</label>
              <select
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Выберите</option>
                <option value="Смирнова А.П.">Смирнова А.П.</option>
                <option value="Козлов Д.В.">Козлов Д.В.</option>
              </select>
            </div>
            <Input
              label="Сумма (₽)"
              type="number"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => {
              onConfirm({ client, equipmentInv, startDate, endDate, manager, amount });
              onClose();
            }}>
              Создать аренду
            </Button>
            <Button variant="secondary" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </div>
    </div>
  );
}