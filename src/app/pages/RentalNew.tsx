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
import { useClientsList } from '../hooks/useClients';
import { useEquipmentList, useUpdateEquipment } from '../hooks/useEquipment';
import { useGanttData } from '../hooks/useRentals';
import { rentalsService } from '../services/rentals.service';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import type { GanttRentalData } from '../mock-data';
import type { EquipmentStatus } from '../types';
import { canEquipmentParticipateInRentals } from '../lib/equipmentClassification';
import { buildRentalCreationHistory, createRentalHistoryEntry } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import { calculateRentalAmount, formatCurrency, getRentalDays } from '../lib/utils';
import { isEquipmentBusy } from '../lib/rental-conflicts';
import { EquipmentCombobox } from '../components/ui/EquipmentCombobox';

export default function RentalNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { user } = useAuth();
  const qc = useQueryClient();
  const updateEquipment = useUpdateEquipment();
  const { data: clients = [] } = useClientsList();
  const { data: rawEq = [] } = useEquipmentList();
  const { data: ganttRentals = [] } = useGanttData();

  const allEq = useMemo(
    () => rawEq.filter(e => canEquipmentParticipateInRentals(e) && e.status !== 'inactive' && e.status !== 'in_service'),
    [rawEq],
  );
  const ganttRents = useMemo(() => ganttRentals, [ganttRentals]);

  useEffect(() => {
    if (!can('create', 'rentals')) navigate('/rentals', { replace: true });
  }, []);

  const today    = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [client, setClient] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(nextWeek);
  const [dailyRate, setDailyRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');

  const rentalDays = useMemo(() => getRentalDays(startDate, endDate), [startDate, endDate]);
  const totalPrice = useMemo(
    () => calculateRentalAmount(Number(dailyRate) || 0, startDate, endDate),
    [dailyRate, startDate, endDate],
  );

  const { availableEq, busyEq } = useMemo(() => {
    if (!startDate || !endDate) return { availableEq: allEq, busyEq: [] };
    const av: typeof allEq = [];
    const bz: typeof allEq = [];
    allEq.forEach(eq => {
      if (isEquipmentBusy(eq, startDate, endDate, ganttRents)) bz.push(eq);
      else av.push(eq);
    });
    return { availableEq: av, busyEq: bz };
  }, [startDate, endDate, allEq, ganttRents]);

  const selectedEquipment = allEq.find(e => e.id === equipmentId);
  const conflictWarn = equipmentId
    ? busyEq.some(e => e.id === equipmentId)
    : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !selectedEquipment) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const initialStatus: GanttRentalData['status'] = startDate <= todayStr ? 'active' : 'created';

    // Gantt entry
    await rentalsService.createGanttEntry({
      client,
      clientShort: client.substring(0, 20),
      equipmentId: selectedEquipment.id,
      equipmentInv: selectedEquipment.inventoryNumber,
      startDate,
      endDate,
      manager: '',
      managerInitials: '',
      status: initialStatus,
      paymentStatus: 'unpaid',
      updSigned: false,
      amount: totalPrice,
      comments: [
        buildRentalCreationHistory(
          {
            client,
            startDate,
            endDate,
            status: initialStatus,
          },
          user?.name || 'Система',
        ),
        ...(notes.trim()
          ? [createRentalHistoryEntry(user?.name || 'Система', notes.trim(), 'comment')]
          : []),
      ],
    });

    // Classic rental
    await rentalsService.create({
      client,
      contact: '',
      startDate,
      plannedReturnDate: endDate,
      equipment: [selectedEquipment.inventoryNumber],
      rate: `${dailyRate} ₽/день`,
      price: totalPrice,
      discount: 0,
      deliveryAddress: '',
      manager: '',
      status: 'new' as const,
      comments: notes,
    });

    // Update equipment status
    if (selectedEquipment) {
      const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
      const equipmentWithHistory = appendAuditHistory(
        {
          ...selectedEquipment,
          status: eqStatus,
          currentClient: initialStatus === 'active' ? client : selectedEquipment.currentClient,
          returnDate: initialStatus === 'active' ? endDate : selectedEquipment.returnDate,
        },
        createAuditEntry(
          user?.name || 'Система',
          initialStatus === 'active'
            ? `Создана аренда и техника выдана клиенту ${client}`
            : `Создана бронь под клиента ${client}`,
        ),
      );
      const { id: _equipmentId, ...equipmentUpdateData } = equipmentWithHistory;
      updateEquipment.mutate({ id: selectedEquipment.id, data: {
        ...equipmentUpdateData,
      } });
    }

    qc.invalidateQueries();
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
                  <EquipmentCombobox
                    equipment={[...availableEq, ...busyEq]}
                    value={equipmentId}
                    valueKey="id"
                    onChange={setEquipmentId}
                    groups={[
                      ...(availableEq.length > 0
                        ? [{ label: '✓ Доступна на выбранный период', items: availableEq }]
                        : []),
                      ...(busyEq.length > 0
                        ? [{ label: '⚠ Занята на выбранный период', items: busyEq }]
                        : []),
                    ]}
                  />
                  {conflictWarn && (
                    <p className="rounded-md border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                      ⚠ Техника занята на выбранный период — выберите другую технику или даты
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Daily Rate + Deposit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ставка в день (₽)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={dailyRate}
                  onChange={(e) => setDailyRate(e.target.value)}
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

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500 dark:text-gray-400">
                  {rentalDays > 0 ? `Итого за ${rentalDays} дн.` : 'Итого'}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalPrice)}</span>
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
