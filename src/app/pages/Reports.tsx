import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { mockEquipment, mockRentals, mockServiceTickets } from '../mock-data';

export default function Reports() {
  const [period, setPeriod] = React.useState('month');

  // Данные утилизации по месяцам
  const utilizationData = [
    { month: 'Янв', utilization: 72 },
    { month: 'Фев', utilization: 85 },
    { month: 'Мар', utilization: 78 },
    { month: 'Апр', utilization: 92 },
    { month: 'Май', utilization: 88 },
    { month: 'Июн', utilization: 95 },
  ];

  // Данные выручки по клиентам
  const revenueByClient = [
    { client: 'ООО СтройМастер', revenue: 850000 },
    { client: 'ООО Технострой', revenue: 1200000 },
    { client: 'АО РемМонтаж', revenue: 650000 },
    { client: 'ИП Петров А.В.', revenue: 320000 },
    { client: 'Прочие', revenue: 480000 },
  ];

  // Причины простоя
  const downtimeData = [
    { reason: 'Плановое ТО', count: 8, color: '#3b82f6' },
    { reason: 'Ремонт', count: 5, color: '#ef4444' },
    { reason: 'Ожидание запчастей', count: 3, color: '#f59e0b' },
    { reason: 'Прочее', count: 2, color: '#6b7280' },
  ];

  // Статистика по типам техники
  const equipmentStats = {
    scissor: mockEquipment.filter(e => e.type === 'scissor').length,
    articulated: mockEquipment.filter(e => e.type === 'articulated').length,
    telescopic: mockEquipment.filter(e => e.type === 'telescopic').length,
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Отчёты</h1>
          <p className="mt-1 text-sm text-gray-500">Аналитика и статистика работы системы</p>
        </div>
        <Select
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: 'week', label: 'За неделю' },
            { value: 'month', label: 'За месяц' },
            { value: 'quarter', label: 'За квартал' },
            { value: 'year', label: 'За год' },
          ]}
          className="w-[160px]"
        />
      </div>

      {/* Key Metrics */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Всего техники</CardDescription>
            <CardTitle className="text-3xl">{mockEquipment.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              В аренде: {mockEquipment.filter(e => e.status === 'rented').length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Активные аренды</CardDescription>
            <CardTitle className="text-3xl">
              {mockRentals.filter(r => r.status === 'active').length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">За текущий период</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Сервисных заявок</CardDescription>
            <CardTitle className="text-3xl">{mockServiceTickets.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              В работе: {mockServiceTickets.filter(t => t.status === 'in_progress').length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Средняя утилизация</CardDescription>
            <CardTitle className="text-3xl">85%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">За последние 6 месяцев</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Utilization Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Утилизация парка по месяцам</CardTitle>
            <CardDescription>Процент техники в аренде</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={utilizationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="utilization" 
                  stroke="#1e40af" 
                  strokeWidth={2}
                  name="Утилизация (%)"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Client */}
        <Card>
          <CardHeader>
            <CardTitle>Выручка по клиентам</CardTitle>
            <CardDescription>Топ клиентов по объёму выручки</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueByClient}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="client" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip 
                  formatter={(value: number) => 
                    new Intl.NumberFormat('ru-RU', { 
                      style: 'currency', 
                      currency: 'RUB',
                      minimumFractionDigits: 0 
                    }).format(value)
                  }
                />
                <Bar dataKey="revenue" fill="#1e40af" name="Выручка" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Downtime Reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Причины простоя техники</CardTitle>
            <CardDescription>Распределение по типам сервиса</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <ResponsiveContainer width="50%" height={250}>
                <PieChart>
                  <Pie
                    data={downtimeData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="count"
                    label
                  >
                    {downtimeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {downtimeData.map((item, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="h-3 w-3 rounded-full" 
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm text-gray-700">{item.reason}</span>
                    </div>
                    <span className="text-sm font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Equipment Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Структура парка по типам</CardTitle>
            <CardDescription>Распределение техники по типам подъёмников</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-700">Ножничные</span>
                  <span className="font-medium">{equipmentStats.scissor} ед.</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div 
                    className="h-2 rounded-full bg-blue-600" 
                    style={{ width: `${(equipmentStats.scissor / mockEquipment.length) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-700">Коленчатые</span>
                  <span className="font-medium">{equipmentStats.articulated} ед.</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div 
                    className="h-2 rounded-full bg-green-600" 
                    style={{ width: `${(equipmentStats.articulated / mockEquipment.length) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-700">Телескопические</span>
                  <span className="font-medium">{equipmentStats.telescopic} ед.</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div 
                    className="h-2 rounded-full bg-purple-600" 
                    style={{ width: `${(equipmentStats.telescopic / mockEquipment.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
