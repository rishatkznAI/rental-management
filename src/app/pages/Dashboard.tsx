import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Plus, TrendingUp, AlertTriangle, Wrench, DollarSign, Calendar, User, Target, FileText, CreditCard } from 'lucide-react';
import { Link } from 'react-router';
import { formatCurrency, formatDate } from '../lib/utils';
import { mockRentals, mockEquipment, mockServiceTickets, mockPayments, mockClients } from '../mock-data';
import { KPIDetailModal } from '../components/modals/KPIDetailModal';
import { ServiceRequestModal } from '../components/modals/ServiceRequestModal';
import { NewClientModal } from '../components/modals/NewClientModal';

export default function Dashboard() {
  const [selectedKPI, setSelectedKPI] = useState<'utilization' | 'activeRentals' | 'overdueReturns' | 'inService' | 'weekRevenue' | 'totalDebt' | 'monthDebt' | null>(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);

  // Вычисляем KPI
  const activeRentals = mockRentals.filter(r => r.status === 'active').length;
  const equipmentInService = mockEquipment.filter(e => e.status === 'in_service').length;
  const overdueReturns = mockRentals.filter(r => r.risk).length;
  
  const totalEquipment = mockEquipment.length;
  const rentedEquipment = mockEquipment.filter(e => e.status === 'rented').length;
  const availableEquipment = mockEquipment.filter(e => e.status === 'available').length;
  const utilization = Math.round((rentedEquipment / totalEquipment) * 100);
  
  const weekRevenue = mockRentals
    .filter(r => r.status === 'active')
    .reduce((sum, r) => sum + r.price, 0);

  // Дебиторка
  const totalDebt = mockClients.reduce((sum, c) => sum + c.debt, 0)
    + mockPayments.filter(p => p.status === 'overdue').reduce((sum, p) => sum + p.amount, 0);
  const monthDebt = mockPayments.filter(p => p.status === 'overdue').reduce((sum, p) => sum + p.amount, 0);

  // Моковые данные менеджера (Смирнова А.П.)
  const managerStats = {
    name: 'Смирнова А.П.',
    activeRentals: 2,
    newContracts: 3,
    monthRevenue: 270000,
    clientDebt: 45000,
    overduePayments: 1,
    planPercent: 78,
  };

  const activeRentalsList = mockRentals.filter(r => r.status === 'active');
  const overdueRentalsList = mockRentals.filter(r => r.risk);
  const equipmentInServiceList = mockEquipment.filter(e => e.status === 'in_service');

  // Критические задачи
  const criticalTickets = mockServiceTickets.filter(t => t.priority === 'critical' || t.priority === 'high');
  const upcomingReturns = mockRentals.filter(r => {
    const daysUntil = Math.ceil((new Date(r.plannedReturnDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil <= 3 && daysUntil >= 0 && r.status === 'active';
  });
  const overduePayments = mockPayments.filter(p => p.status === 'overdue');

  const kpiData = {
    utilization: { totalEquipment, rentedEquipment, availableEquipment, utilization },
    activeRentals: { activeRentals: activeRentalsList },
    overdueReturns: { overdueRentals: overdueRentalsList },
    inService: { equipmentInService: equipmentInServiceList },
    weekRevenue: { 
      weekRevenue, 
      activeRentalsCount: activeRentalsList.length,
      averagePrice: activeRentalsList.length > 0 ? Math.round(weekRevenue / activeRentalsList.length) : 0
    },
    totalDebt: { totalDebt, clients: mockClients.filter(c => c.debt > 0), overduePayments },
    monthDebt: { monthDebt, overduePayments },
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Дашборд</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Обзор ключевых показателей системы</p>
        </div>
        <div className="flex gap-3">
          <Link to="/rentals/new">
            <Button>
              <Plus className="h-4 w-4" />
              Новая аренда
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => setShowServiceModal(true)}>
            <Plus className="h-4 w-4" />
            Заявка в сервис
          </Button>
          <Button variant="secondary" onClick={() => setShowClientModal(true)}>
            <Plus className="h-4 w-4" />
            Новый клиент
          </Button>
        </div>
      </div>

      {/* KPI Cards — row 1 (5 основных) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('utilization')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Утилизация парка <span className="text-xs text-gray-400">· за месяц</span></CardDescription>
            <CardTitle className="text-3xl">{utilization}%</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span>{rentedEquipment} из {totalEquipment} единиц</span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('activeRentals')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Активные аренды</CardDescription>
            <CardTitle className="text-3xl">{activeRentals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">Текущих договоров</p>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('overdueReturns')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Просроченные возвраты</CardDescription>
            <CardTitle className="text-3xl text-red-600">{overdueReturns}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <span>Требует внимания</span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('inService')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Техника в сервисе</CardDescription>
            <CardTitle className="text-3xl">{equipmentInService}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Wrench className="h-4 w-4" />
              <span>На обслуживании</span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('weekRevenue')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Выручка за неделю</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(weekRevenue)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <DollarSign className="h-4 w-4" />
              <span>Активные договоры</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Cards — row 2 (дебиторка) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('totalDebt')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Общая дебиторка</CardDescription>
            <CardTitle className={`text-2xl ${totalDebt > 0 ? 'text-orange-600' : ''}`}>
              {formatCurrency(totalDebt)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <CreditCard className="h-4 w-4 text-orange-500" />
              <span>{mockClients.filter(c => c.debt > 0).length + overduePayments.length} позиций</span>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setSelectedKPI('monthDebt')}
        >
          <CardHeader className="pb-2">
            <CardDescription>Дебиторка за месяц</CardDescription>
            <CardTitle className={`text-2xl ${monthDebt > 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(monthDebt)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span>{overduePayments.length} просроч. платежей</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manager Stats Block */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-[--color-primary]" />
            Результаты менеджера за текущий месяц
          </CardTitle>
          <CardDescription>{managerStats.name} · март 2026</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Активные аренды</p>
              <p className="mt-1 text-2xl text-blue-700 dark:text-blue-300">{managerStats.activeRentals}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Новые договоры</p>
              <p className="mt-1 text-2xl text-green-700 dark:text-green-300">{managerStats.newContracts}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Выручка</p>
              <p className="mt-1 text-xl text-emerald-700 dark:text-emerald-300">{formatCurrency(managerStats.monthRevenue)}</p>
            </div>
            <div className="rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Дебиторка клиентов</p>
              <p className="mt-1 text-xl text-orange-700 dark:text-orange-300">{formatCurrency(managerStats.clientDebt)}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Просроч. оплаты</p>
              <p className="mt-1 text-2xl text-red-700 dark:text-red-300">{managerStats.overduePayments}</p>
            </div>
            <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-900/20">
              <p className="text-xs text-gray-500 dark:text-gray-400">Выполнение плана</p>
              <div className="mt-1 flex items-end gap-1.5">
                <p className="text-2xl text-purple-700 dark:text-purple-300">{managerStats.planPercent}%</p>
                <Target className="mb-1 h-4 w-4 text-purple-400" />
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-purple-100 dark:bg-purple-900/30">
                <div
                  className="h-full rounded-full bg-purple-500"
                  style={{ width: `${managerStats.planPercent}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts & Quick Info */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alerts Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Требует внимания
            </CardTitle>
            <CardDescription>Критические события и задачи</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Overdue Payments */}
            {overduePayments.length > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="h-5 w-5 text-red-600" />
                  <div className="flex-1">
                    <p className="font-medium text-red-900 dark:text-red-200">Просроченные платежи</p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                      {overduePayments.length} платеж(ей) просрочено на общую сумму{' '}
                      {formatCurrency(overduePayments.reduce((sum, p) => sum + p.amount, 0))}
                    </p>
                    <Link to="/payments" className="mt-2 inline-block text-sm font-medium text-red-800 dark:text-red-200 hover:underline">
                      Перейти к платежам →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming Returns */}
            {upcomingReturns.length > 0 && (
              <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-yellow-600" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-900 dark:text-yellow-200">Возвраты в ближайшие 3 дня</p>
                    <div className="mt-2 space-y-1">
                      {upcomingReturns.slice(0, 3).map(rental => (
                        <p key={rental.id} className="text-sm text-yellow-700 dark:text-yellow-300">
                          {rental.client} — {formatDate(rental.plannedReturnDate)}
                        </p>
                      ))}
                    </div>
                    <Link to="/rentals" className="mt-2 inline-block text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline">
                      Смотреть все →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Critical Service Tickets */}
            {criticalTickets.length > 0 && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4">
                <div className="flex items-start gap-3">
                  <Wrench className="h-5 w-5 text-orange-600" />
                  <div className="flex-1">
                    <p className="font-medium text-orange-900 dark:text-orange-200">Критические заявки сервиса</p>
                    <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
                      {criticalTickets.length} критических заявок требуют срочного внимания
                    </p>
                    <Link to="/service" className="mt-2 inline-block text-sm font-medium text-orange-800 dark:text-orange-200 hover:underline">
                      Открыть сервис →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {overduePayments.length === 0 && upcomingReturns.length === 0 && criticalTickets.length === 0 && (
              <div className="flex items-center justify-center py-8 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                    <TrendingUp className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Все хорошо! Нет критических задач.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions / Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Последние аренды</CardTitle>
            <CardDescription>Недавно созданные договоры аренды</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockRentals.slice(0, 5).map(rental => (
                <Link
                  key={rental.id}
                  to={`/rentals/${rental.id}`}
                  className="flex items-center justify-between rounded-lg border border-transparent px-2 py-3 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-700/50 -mx-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{rental.client}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {rental.id} · {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                    </p>
                  </div>
                  <div className="ml-4 flex flex-col items-end">
                    <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                    <span className="text-sm text-[--color-primary]">
                      Открыть →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modals */}
      <KPIDetailModal
        open={selectedKPI !== null}
        onOpenChange={(open) => !open && setSelectedKPI(null)}
        kpiType={selectedKPI}
        data={selectedKPI ? kpiData[selectedKPI] : {}}
      />

      <ServiceRequestModal
        open={showServiceModal}
        onOpenChange={setShowServiceModal}
      />

      <NewClientModal
        open={showClientModal}
        onOpenChange={setShowClientModal}
      />
    </div>
  );
}
