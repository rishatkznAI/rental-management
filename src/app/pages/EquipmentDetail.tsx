import React, { useState } from 'react';
import { useParams, Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge, getEquipmentStatusBadge } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import {
  ArrowLeft, CircleAlert, FileText, Image as ImageIcon, Wrench, Camera,
  DollarSign, TrendingUp, Clock, Plus, Bot, User, Calendar
} from 'lucide-react';
import {
  mockEquipment, mockRentals, mockServiceTickets,
  mockRepairRecords, mockShippingPhotos, mockGanttRentals,
} from '../mock-data';
import { formatDate, formatCurrency, getDaysUntil } from '../lib/utils';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import type { EquipmentOwnerType, RepairEventType } from '../types';

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

export default function EquipmentDetail() {
  const { id } = useParams();
  const equipment = mockEquipment.find(e => e.id === id);
  const [showRepairModal, setShowRepairModal] = useState(false);

  if (!equipment) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Техника не найдена</h2>
          <Link to="/equipment" className="mt-4 inline-block text-[--color-primary] hover:underline">
            ← Вернуться к списку
          </Link>
        </div>
      </div>
    );
  }

  const rentalHistory = mockRentals.filter(r =>
    r.equipment.includes(equipment.inventoryNumber)
  );
  const ganttRentals = mockGanttRentals.filter(r =>
    r.equipmentInv === equipment.inventoryNumber
  );
  const serviceHistory = mockServiceTickets.filter(s =>
    s.equipmentId === equipment.id
  );
  const repairRecords = mockRepairRecords.filter(r =>
    r.equipmentId === equipment.id
  ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const shippingPhotos = mockShippingPhotos.filter(p =>
    p.equipmentId === equipment.id
  ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const daysUntilMaintenance = getDaysUntil(equipment.nextMaintenance);

  // === Финансовые расчёты ===
  const daysInMonth = 31; // март 2026
  const activeMonthRentals = ganttRentals.filter(r => {
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    const monthStart = new Date('2026-03-01');
    const monthEnd = new Date('2026-03-31');
    return start <= monthEnd && end >= monthStart;
  });

  const daysRentedThisMonth = activeMonthRentals.reduce((sum, r) => {
    const start = new Date(Math.max(new Date(r.startDate).getTime(), new Date('2026-03-01').getTime()));
    const end = new Date(Math.min(new Date(r.endDate).getTime(), new Date('2026-03-31').getTime()));
    return sum + Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  }, 0);

  const freeDaysThisMonth = daysInMonth - daysRentedThisMonth;
  const utilizationMonth = Math.round((daysRentedThisMonth / daysInMonth) * 100);
  const actualMonthRevenue = activeMonthRentals.reduce((sum, r) => {
    const rentalDays = Math.ceil((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / (1000 * 60 * 60 * 24));
    const dailyRate = r.amount / Math.max(rentalDays, 1);
    const start = new Date(Math.max(new Date(r.startDate).getTime(), new Date('2026-03-01').getTime()));
    const end = new Date(Math.min(new Date(r.endDate).getTime(), new Date('2026-03-31').getTime()));
    const daysInPeriod = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return sum + dailyRate * daysInPeriod;
  }, 0);

  // Расчёт комиссии менеджера
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

  const tabTriggerClass = "border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary] dark:text-gray-400 dark:hover:text-gray-200";

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div>
        <Link to="/equipment" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>
        <div className="mt-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{equipment.inventoryNumber}</h1>
              {getEquipmentStatusBadge(equipment.status)}
              <Badge variant={equipment.owner === 'own' ? 'success' : equipment.owner === 'investor' ? 'info' : 'warning'}>
                {ownerLabels[equipment.owner]}
              </Badge>
            </div>
            <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">{equipment.manufacturer} {equipment.model}</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary">Сдать</Button>
            <Button variant="secondary">Вернуть</Button>
            <Button variant="secondary">В сервис</Button>
          </div>
        </div>
      </div>

      {/* Photo and Key Info */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="p-0">
            {equipment.photo ? (
              <img src={equipment.photo} alt={equipment.model} className="h-64 w-full rounded-lg object-cover" />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <ImageIcon className="h-16 w-16 text-gray-400" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Основные характеристики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Производитель</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.manufacturer}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Модель</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.model}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Тип</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {equipment.type === 'scissor' ? 'Ножничный' : equipment.type === 'articulated' ? 'Коленчатый' : 'Телескопический'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Привод</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.drive === 'diesel' ? 'Дизель' : 'Электро'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Серийный номер</p>
                <p className="font-mono text-sm text-gray-900 dark:text-white">{equipment.serialNumber}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Год выпуска</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.year}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Моточасы</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.hours} ч</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Высота подъёма</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.liftHeight} м</p>
              </div>
              {equipment.workingHeight && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Рабочая высота</p>
                  <p className="font-medium text-gray-900 dark:text-white">{equipment.workingHeight} м</p>
                </div>
              )}
              {equipment.loadCapacity && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Грузоподъёмность</p>
                  <p className="font-medium text-gray-900 dark:text-white">{equipment.loadCapacity} кг</p>
                </div>
              )}
              {equipment.dimensions && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Габариты</p>
                  <p className="font-medium text-gray-900 dark:text-white">{equipment.dimensions}</p>
                </div>
              )}
              {equipment.weight && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Масса</p>
                  <p className="font-medium text-gray-900 dark:text-white">{equipment.weight} кг</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Локация</p>
                <p className="font-medium text-gray-900 dark:text-white">{equipment.location}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Владелец</p>
                <p className="font-medium text-gray-900 dark:text-white">{ownerLabels[equipment.owner]}</p>
              </div>
              {equipment.owner === 'sublease' && equipment.subleasePrice && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Стоимость субаренды</p>
                  <p className="font-medium text-orange-600">{formatCurrency(equipment.subleasePrice)}/мес</p>
                </div>
              )}
              {equipment.currentClient && (
                <>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Текущий клиент</p>
                    <p className="font-medium text-gray-900 dark:text-white">{equipment.currentClient}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Дата возврата</p>
                    <p className="font-medium text-gray-900 dark:text-white">{equipment.returnDate ? formatDate(equipment.returnDate) : '—'}</p>
                  </div>
                </>
              )}
            </div>
            {/* ТО dates */}
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">След. ТО</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatDate(equipment.nextMaintenance)}</p>
              </div>
              {equipment.maintenanceCHTO && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата ЧТО</p>
                  <p className="font-medium text-gray-900 dark:text-white">{formatDate(equipment.maintenanceCHTO)}</p>
                </div>
              )}
              {equipment.maintenancePTO && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата ПТО</p>
                  <p className="font-medium text-gray-900 dark:text-white">{formatDate(equipment.maintenancePTO)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Maintenance Alert */}
      {daysUntilMaintenance <= 30 && (
        <div className={`rounded-lg border p-4 ${
          daysUntilMaintenance <= 7
            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'
        }`}>
          <div className="flex items-start gap-3">
            <CircleAlert className={`h-5 w-5 ${daysUntilMaintenance <= 7 ? 'text-red-600' : 'text-yellow-600'}`} />
            <div className="flex-1">
              <p className={`font-medium ${daysUntilMaintenance <= 7 ? 'text-red-900 dark:text-red-200' : 'text-yellow-900 dark:text-yellow-200'}`}>
                Техническое обслуживание через {daysUntilMaintenance} дней
              </p>
              <p className={`mt-1 text-sm ${daysUntilMaintenance <= 7 ? 'text-red-700 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                Запланировано на {formatDate(equipment.nextMaintenance)}
              </p>
            </div>
            <Button size="sm" variant="secondary">Запланировать ТО</Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs.Root defaultValue="financial" className="space-y-6">
        <Tabs.List className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          <Tabs.Trigger value="financial" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Финансы</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="rental-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> История аренды</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="repair-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Ремонты</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="photos" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Фото</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="service-history" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Сервис</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="documents" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Документы</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="overview" className={tabTriggerClass}>
            Обзор
          </Tabs.Trigger>
        </Tabs.List>

        {/* === FINANCIAL TAB === */}
        <Tabs.Content value="financial">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[--color-primary]" />
                  Финансовые показатели · Март 2026
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

                {/* Revenue vs plan */}
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Выполнение плана</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full ${
                        actualMonthRevenue >= equipment.plannedMonthlyRevenue ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100))}%` }}
                    />
                  </div>
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

                <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
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

        {/* === RENTAL HISTORY TAB === */}
        <Tabs.Content value="rental-history">
          <Card>
            <CardHeader>
              <CardTitle>История аренды</CardTitle>
              <CardDescription>{rentalHistory.length + ganttRentals.filter(g => !rentalHistory.find(r => r.id === g.id)).length} записей</CardDescription>
            </CardHeader>
            <CardContent>
              {(rentalHistory.length > 0 || ganttRentals.length > 0) ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Период</TableHead>
                      <TableHead>Длительность</TableHead>
                      <TableHead>Менедже��</TableHead>
                      <TableHead>Стоимость</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Combine rental sources, prefer Gantt for richer data */}
                    {ganttRentals.map(gr => {
                      const days = Math.ceil((new Date(gr.endDate).getTime() - new Date(gr.startDate).getTime()) / (1000 * 60 * 60 * 24));
                      return (
                        <TableRow key={gr.id}>
                          <TableCell>
                            <Link to={`/rentals/${gr.id.replace(/[ab]$/, '')}`} className="text-[--color-primary] hover:underline">
                              {gr.id}
                            </Link>
                          </TableCell>
                          <TableCell>{gr.client}</TableCell>
                          <TableCell className="text-sm">
                            {formatDate(gr.startDate)} — {formatDate(gr.endDate)}
                          </TableCell>
                          <TableCell>{days} дн.</TableCell>
                          <TableCell>{gr.manager}</TableCell>
                          <TableCell>{formatCurrency(gr.amount)}</TableCell>
                          <TableCell>
                            <Badge variant={
                              gr.status === 'active' ? 'success' :
                              gr.status === 'returned' ? 'info' :
                              gr.status === 'closed' ? 'default' : 'warning'
                            }>
                              {gr.status === 'active' ? 'Активна' :
                               gr.status === 'returned' ? 'Возвращена' :
                               gr.status === 'closed' ? 'Закрыта' : 'Создана'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Show standard rentals not already in gantt */}
                    {rentalHistory
                      .filter(r => !ganttRentals.find(g => g.id === r.id || g.id.startsWith(r.id)))
                      .map(rental => {
                        const days = Math.ceil((new Date(rental.plannedReturnDate).getTime() - new Date(rental.startDate).getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <TableRow key={rental.id}>
                            <TableCell>
                              <Link to={`/rentals/${rental.id}`} className="text-[--color-primary] hover:underline">
                                {rental.id}
                              </Link>
                            </TableCell>
                            <TableCell>{rental.client}</TableCell>
                            <TableCell className="text-sm">
                              {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                            </TableCell>
                            <TableCell>{days} дн.</TableCell>
                            <TableCell>{rental.manager}</TableCell>
                            <TableCell>{formatCurrency(rental.price)}</TableCell>
                            <TableCell>
                              <Badge variant={rental.status === 'active' ? 'success' : rental.status === 'closed' ? 'default' : 'warning'}>
                                {rental.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Calendar className="h-12 w-12" />} text="История аренды пуста" />
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* === REPAIR HISTORY TAB === */}
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
                    <div
                      key={record.id}
                      className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={repairTypeBadge[record.type]}>{repairTypeLabels[record.type]}</Badge>
                            <Badge variant={
                              record.status === 'completed' ? 'success' :
                              record.status === 'in_progress' ? 'info' : 'default'
                            }>
                              {record.status === 'completed' ? 'Выполнено' :
                               record.status === 'in_progress' ? 'В работе' : 'Запланировано'}
                            </Badge>
                            {record.source === 'bot' && (
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Bot className="h-3 w-3" /> Из бота
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-gray-900 dark:text-white">{record.description}</p>
                          {record.comment && (
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{record.comment}</p>
                          )}
                          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {formatDate(record.date)}
                            </span>
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" /> {record.mechanic}
                            </span>
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

        {/* === PHOTOS TAB === */}
        <Tabs.Content value="photos">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Фото отгрузок и приёмки</CardTitle>
                  <CardDescription>{shippingPhotos.length} событий</CardDescription>
                </div>
                <Button size="sm" variant="secondary">
                  <Plus className="h-4 w-4" />
                  Загрузить фото
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {shippingPhotos.length > 0 ? (
                <div className="space-y-6">
                  {shippingPhotos.map(event => (
                    <div key={event.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant={event.type === 'shipping' ? 'info' : 'success'}>
                            {event.type === 'shipping' ? 'Отгрузка' : 'Приёмка'}
                          </Badge>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(event.date)}</span>
                          {event.source === 'bot' && (
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <Bot className="h-3 w-3" /> Из бота
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Загрузил: {event.uploadedBy}</span>
                      </div>
                      {event.comment && (
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{event.comment}</p>
                      )}
                      {event.rentalId && (
                        <Link to={`/rentals/${event.rentalId}`} className="mt-1 inline-block text-xs text-[--color-primary] hover:underline">
                          Аренда {event.rentalId} →
                        </Link>
                      )}
                      <div className="mt-3 flex gap-3 overflow-x-auto">
                        {event.photos.map((photo, idx) => (
                          <img
                            key={idx}
                            src={photo}
                            alt={`Фото ${idx + 1}`}
                            className="h-32 w-48 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Camera className="h-12 w-12" />} text="Фотографий пока нет" />
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* === SERVICE HISTORY TAB === */}
        <Tabs.Content value="service-history">
          <Card>
            <CardHeader>
              <CardTitle>Сервисные заявки</CardTitle>
            </CardHeader>
            <CardContent>
              {serviceHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Причина</TableHead>
                      <TableHead>Дата создания</TableHead>
                      <TableHead>Приоритет</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceHistory.map(ticket => (
                      <TableRow key={ticket.id}>
                        <TableCell>
                          <Link to={`/service/${ticket.id}`} className="text-[--color-primary] hover:underline">
                            {ticket.id}
                          </Link>
                        </TableCell>
                        <TableCell>{ticket.reason}</TableCell>
                        <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.priority === 'critical' ? 'error' :
                            ticket.priority === 'high' ? 'warning' :
                            ticket.priority === 'medium' ? 'info' : 'default'
                          }>
                            {ticket.priority === 'critical' ? 'Критический' :
                             ticket.priority === 'high' ? 'Высокий' :
                             ticket.priority === 'medium' ? 'Средний' : 'Низкий'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.status === 'in_progress' ? 'info' :
                            ticket.status === 'waiting_parts' ? 'warning' :
                            ticket.status === 'ready' ? 'success' : 'default'
                          }>
                            {ticket.status === 'in_progress' ? 'В работе' :
                             ticket.status === 'waiting_parts' ? 'Ожидание запчастей' :
                             ticket.status === 'ready' ? 'Готово' :
                             ticket.status === 'new' ? 'Новая' : 'Закрыта'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Wrench className="h-12 w-12" />} text="Сервисных заявок нет" />
              )}
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* === DOCUMENTS TAB === */}
        <Tabs.Content value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Документы</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState icon={<FileText className="h-12 w-12" />} text="Документов нет">
                <Button variant="secondary" size="sm" className="mt-4">
                  Загрузить документ
                </Button>
              </EmptyState>
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* === OVERVIEW TAB === */}
        <Tabs.Content value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Примечания</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-900 dark:text-white">{equipment.notes || 'Примечаний нет'}</p>
            </CardContent>
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      {/* Add Repair Record Modal */}
      <AddRepairModal open={showRepairModal} onOpenChange={setShowRepairModal} />
    </div>
  );
}

// === Helper Components ===

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
  const [form, setForm] = useState({
    date: '',
    type: 'maintenance',
    description: '',
    comment: '',
    mechanic: '',
    status: 'completed',
    cost: '',
  });

  const update = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
          <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">
            Добавить запись о ремонте
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Заполните информацию о ремонте или обслуживании
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Дата" type="date" value={form.date} onChange={e => update('date', e.target.value)} required />
              <Select
                label="Тип события"
                value={form.type}
                onValueChange={v => update('type', v)}
                options={[
                  { value: 'maintenance', label: 'Обслуживание' },
                  { value: 'repair', label: 'Ремонт' },
                  { value: 'diagnostics', label: 'Диагностика' },
                  { value: 'breakdown', label: 'Поломка' },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Описание работ</label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] focus:border-transparent dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Что было сделано..."
                value={form.description}
                onChange={e => update('description', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Комментарий</label>
              <textarea
                className="flex min-h-[40px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] focus:border-transparent dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Дополнительно..."
                value={form.comment}
                onChange={e => update('comment', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Исполнитель" placeholder="Фамилия И.О." value={form.mechanic} onChange={e => update('mechanic', e.target.value)} required />
              <Input label="Сумма (₽)" type="number" placeholder="0" value={form.cost} onChange={e => update('cost', e.target.value)} />
            </div>
            <Select
              label="Статус"
              value={form.status}
              onValueChange={v => update('status', v)}
              options={[
                { value: 'completed', label: 'Выполнено' },
                { value: 'in_progress', label: 'В работе' },
                { value: 'planned', label: 'Запланировано' },
              ]}
            />
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={() => onOpenChange(false)}>
              Сохранить
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
