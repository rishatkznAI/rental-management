import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import {
  loadRentals, saveRentals,
  loadClients,
  loadEquipment, saveEquipment,
  loadGanttRentals, saveGanttRentals,
} from '../mock-data';
import type { GanttRentalData } from '../mock-data';
import type { EquipmentStatus } from '../types';

// Helper: check date overlap
function isEquipmentBusy(invNumber: string, startDate: string, endDate: string, rentals: GanttRentalData[]): boolean {
  if (!startDate || !endDate) return false;
  const newStart = new Date(startDate).getTime();
  const newEnd   = new Date(endDate).getTime();
  return rentals.some(r => {
    if (r.equipmentInv !== invNumber) return false;
    if (r.status === 'returned' || r.status === 'closed') return false;
    const rStart = new Date(r.startDate).getTime();
    const rEnd   = new Date(r.endDate).getTime();
    return newStart <= rEnd && newEnd >= rStart;
  });
}

export default function RentalNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();

  useEffect(() => {
    if (!can('create', 'rentals')) navigate('/rentals', { replace: true });
  }, []);

  const clients   = useMemo(() => loadClients(), []);
  const allEq     = useMemo(() => loadEquipment().filter(e => e.status !== 'inactive' && e.status !== 'in_service'), []);
  const ganttRents = useMemo(() => loadGanttRentals(), []);

  const today    = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client,       setClient]       = useState('');
  const [equipmentInv, setEquipmentInv] = useState('');
  const [startDate,    setStartDate]    = useState(today);
  const [endDate,      setEndDate]      = useState(nextWeek);
  const [price,        setPrice]        = useState('');
  const [deposit,      setDeposit]      = useState('');
  const [notes,        setNotes]        = useState('');

  const { availableEq, busyEq } = useMemo(() => {
    if (!startDate || !endDate) return { availableEq: allEq, busyEq: [] };
    const av: typeof allEq = [];
    const bz: typeof allEq = [];
    allEq.forEach(eq => {
      if (isEquipmentBusy(eq.inventoryNumber, startDate, endDate, ganttRents)) bz.push(eq);
      else av.push(eq);
    });
    return { availableEq: av, busyEq: bz };
  }, [startDate, endDate, allEq, ganttRents]);

  const conflictWarn = equipmentInv
    ? busyEq.some(e => e.inventoryNumber === equipmentInv)
    : false;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const todayStr = new Date().toISOString().split('T')[0];
    const initialStatus: GanttRentalData['status'] = startDate <= todayStr ? 'active' : 'created';

    // Save to GanttRentals (Rentals planner)
    const newGantt: GanttRentalData = {
      id: `GR-${Date.now()}`,
      client,
      clientShort: client.substring(0, 20),
      equipmentInv,
      startDate,
      endDate,
      manager: '',
      managerInitials: '',
      status: initialStatus,
      paymentStatus: 'unpaid',
      updSigned: false,
      amount: Number(price) || 0,
      comments: [],
    };
    saveGanttRentals([...ganttRents, newGantt]);

    // Save to classic Rentals list
    const existing = loadRentals();
    saveRentals([...existing, {
      id: `r-${Date.now()}`,
      client,
      contact: '',
      startDate,
      plannedReturnDate: endDate,
      equipment: equipmentInv ? [equipmentInv] : [],
      rate: `${price} ₽/день`,
      price: Number(price) || 0,
      discount: 0,
      deliveryAddress: '',
      manager: '',
      status: 'new' as const,
      comments: notes,
    }]);

    // Update equipment status
    if (equipmentInv) {
      const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
      const updated = loadEquipment().map(e => {
        if (e.inventoryNumber !== equipmentInv) return e;
        return {
          ...e,
          status: eqStatus,
          currentClient: initialStatus === 'active' ? client : e.currentClient,
          returnDate: initialStatus === 'active' ? endDate : e.returnDate,
        };
      });
      saveEquipment(updated);
    }

    navigate('/rentals');
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Новая аренда</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание договора аренды</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Основная информация</CardTitle>
          <CardDescription>Заполните данные о договоре аренды</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Client */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Клиент <span className="text-red-500">*</span></label>
              {clients.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-400">
                  Клиентов нет — добавьте в разделе «Клиенты»
                </p>
              ) : (
                <Select value={client} onValueChange={setClient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите клиента" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map(c => (
                      <SelectItem key={c.id} value={c.company}>{c.company}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Dates — before equipment to check availability */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Дата начала <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Дата окончания <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Equipment */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Техника <span className="text-red-500">*</span></label>
              {allEq.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-400">
                  Сначала добавьте технику в реестр (раздел «Техника»)
                </p>
              ) : (
                <>
                  {availableEq.length === 0 && startDate && endDate && (
                    <p className="rounded-lg border border-dashed border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-sm text-orange-600 dark:text-orange-400">
                      Нет свободной техники на выбранный период
                    </p>
                  )}
                  <Select value={equipmentInv} onValueChange={setEquipmentInv}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите технику" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEq.length > 0 && availableEq.map(eq => (
                        <SelectItem key={eq.inventoryNumber} value={eq.inventoryNumber}>
                          ✓ {eq.inventoryNumber} {eq.model}
                        </SelectItem>
                      ))}
                      {busyEq.length > 0 && busyEq.map(eq => (
                        <SelectItem key={eq.inventoryNumber} value={eq.inventoryNumber}>
                          ⚠ {eq.inventoryNumber} {eq.model} — занята
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {conflictWarn && (
                    <p className="rounded-md border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                      ⚠ Техника занята на выбранный период — выберите другую технику или даты
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Price + Deposit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Сумма (₽)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Залог (₽)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Примечания
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Дополнительная информация о договоре"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={!client || !equipmentInv || !startDate || !endDate}>
                Создать договор
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/rentals')}
              >
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
