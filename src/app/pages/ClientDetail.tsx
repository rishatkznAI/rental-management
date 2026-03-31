import React from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Edit, FileText, TrendingUp, Clock, Phone, Mail, Building2 } from 'lucide-react';
import { formatDate, formatCurrency } from '../lib/utils';
import { mockClients, mockRentals, mockDocuments } from '../mock-data';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = mockClients.find(c => c.id === id);

  if (!client) {
    return (
      <div className="space-y-6 p-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Клиент не найден</h2>
          <Button className="mt-4" onClick={() => navigate('/clients')}>
            Вернуться к списку
          </Button>
        </div>
      </div>
    );
  }

  // Найти аренды клиента
  const clientRentals = mockRentals.filter(r => r.client === client.company);
  
  // Найти документы клиента
  const clientDocuments = mockDocuments.filter(d => d.client === client.company);

  const getDebtBadge = (debt: number) => {
    if (debt === 0) return <Badge variant="success">Нет задолженности</Badge>;
    if (debt > 0 && debt <= 50000) return <Badge variant="warning">Есть задолженность</Badge>;
    return <Badge variant="danger">Высокая задолженность</Badge>;
  };

  const getRentalStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
      new: { label: 'Новая', variant: 'default' },
      confirmed: { label: 'Подтверждена', variant: 'info' },
      active: { label: 'Активная', variant: 'success' },
      completed: { label: 'Завершена', variant: 'default' },
      cancelled: { label: 'Отменена', variant: 'danger' }
    };
    const statusInfo = statusMap[status] || { label: status, variant: 'default' as const };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/clients')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{client.company}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">ИНН: {client.inn}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary">
            <Edit className="h-4 w-4" />
            Редактировать
          </Button>
          <Button>
            <FileText className="h-4 w-4" />
            Новая аренда
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Основная информация</CardTitle>
              <CardDescription>Контактные данные клиента</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Организация
                  </p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.company}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">ИНН</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.inn}</p>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Контактное лицо</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.contact}</p>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Телефон
                  </p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email
                  </p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.email}</p>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Условия оплаты</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">{client.paymentTerms}</p>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Кредитный лимит</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">{formatCurrency(client.creditLimit)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Задолженность</p>
                  <div className="mt-1">
                    <p className="font-medium text-gray-900 dark:text-white mb-1">{formatCurrency(client.debt)}</p>
                    {getDebtBadge(client.debt)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Rentals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                История аренд
              </CardTitle>
              <CardDescription>Последние операции с клиентом</CardDescription>
            </CardHeader>
            <CardContent>
              {clientRentals.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Аренд не найдено</p>
              ) : (
                <div className="space-y-3">
                  {clientRentals.map((rental) => (
                    <div
                      key={rental.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer transition-colors"
                      onClick={() => navigate(`/rentals/${rental.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-gray-900 dark:text-white">{rental.id}</p>
                            {getRentalStatusBadge(rental.status)}
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {rental.equipment.join(', ')}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{rental.rate}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Документы
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clientDocuments.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Документов не найдено</p>
              ) : (
                <div className="space-y-2">
                  {clientDocuments.slice(0, 5).map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.number}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(doc.date)}</p>
                      </div>
                      <Badge variant={doc.status === 'signed' ? 'success' : 'default'}>
                        {doc.status === 'signed' ? 'Подписан' : doc.status === 'sent' ? 'Отправлен' : 'Черновик'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Side Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Статистика
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Всего аренд</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{client.totalRentals}</p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Активных аренд</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                  {clientRentals.filter(r => r.status === 'active').length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Активность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Последняя аренда</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">
                  {client.lastRentalDate ? formatDate(client.lastRentalDate) : '—'}
                </p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Клиент с</p>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">Январь 2024</p>
              </div>
            </CardContent>
          </Card>

          {client.debt > 0 && (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardHeader>
                <CardTitle className="text-red-900 dark:text-red-200">Внимание!</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-red-700 dark:text-red-300">
                  У клиента есть задолженность {formatCurrency(client.debt)}. Рекомендуется связаться с клиентом.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
