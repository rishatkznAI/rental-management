import React from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { getRentalStatusBadge } from '../components/ui/badge';
import {
  ArrowLeft, Edit, FileText, DollarSign, User, Calendar,
  Truck, Clock, MessageSquare, Wrench, AlertTriangle, CircleCheck
} from 'lucide-react';
import { formatCurrency, formatDate, getDaysUntil } from '../lib/utils';
import { mockRentals, mockEquipment, mockServiceTickets, mockPayments, mockClients, mockDocuments } from '../mock-data';
import type { RentalStatus } from '../types';

// Mock extended rental data for detail view
const rentalExtendedData: Record<string, {
  paidAmount: number;
  debt: number;
  comments: { date: string; text: string; author: string }[];
  history: { date: string; action: string; user: string }[];
}> = {
  'R-001': {
    paidAmount: 85000,
    debt: 0,
    comments: [
      { date: '2026-02-15', text: 'Техника доставлена на объект. Клиент подтвердил приёмку.', author: 'Смирнова А.П.' },
      { date: '2026-02-16', text: 'УПД подписан, скан загружен в систему.', author: 'Смирнова А.П.' },
    ],
    history: [
      { date: '2026-02-14', action: 'Аренда создана', user: 'Смирнова А.П.' },
      { date: '2026-02-14', action: 'Статус → Подтверждён', user: 'Смирнова А.П.' },
      { date: '2026-02-15', action: 'Статус → Активен', user: 'Смирнова А.П.' },
      { date: '2026-02-16', action: 'Документ: УПД подписан', user: 'Смирнова А.П.' },
      { date: '2026-02-28', action: 'Оплата получена: 85 000 ₽', user: 'Козлов Д.В.' },
    ],
  },
  'R-002': {
    paidAmount: 0,
    debt: 31500,
    comments: [],
    history: [
      { date: '2026-03-04', action: 'Аренда создана', user: 'Козлов Д.В.' },
      { date: '2026-03-04', action: 'Статус → Подтверждён', user: 'Козлов Д.В.' },
    ],
  },
  'R-003': {
    paidAmount: 65000,
    debt: 45000,
    comments: [
      { date: '2026-02-01', text: 'Две единицы техники доставлены на объект.', author: 'Смирнова А.П.' },
      { date: '2026-03-01', text: 'Техника возвращена. Обнаружено незначительное повреждение на INV-001 — требуется осмотр.', author: 'Смирнова А.П.' },
    ],
    history: [
      { date: '2026-01-30', action: 'Аренда создана', user: 'Смирнова А.П.' },
      { date: '2026-01-31', action: 'Статус → Подтверждён', user: 'Смирнова А.П.' },
      { date: '2026-02-01', action: 'Статус → Активен', user: 'Смирнова А.П.' },
      { date: '2026-02-15', action: 'Частичная оплата: 65 000 ₽', user: 'Козлов Д.В.' },
      { date: '2026-03-01', action: 'Техника возвращена', user: 'Смирнова А.П.' },
    ],
  },
  'R-004': {
    paidAmount: 0,
    debt: 0,
    comments: [],
    history: [
      { date: '2026-03-08', action: 'Аренда создана', user: 'Козлов Д.В.' },
    ],
  },
};

const statusLabels: Record<RentalStatus, string> = {
  new: 'Создана',
  confirmed: 'Подтверждена',
  delivery: 'Доставка',
  active: 'Активна',
  return_planned: 'Возврат запланирован',
  closed: 'Закрыта',
};

export default function RentalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const rental = mockRentals.find(r => r.id === id);

  if (!rental) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Аренда не найдена</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Договор с ID «{id}» не существует</p>
          <Button className="mt-4" onClick={() => navigate('/rentals')}>
            Вернуться к списку
          </Button>
        </div>
      </div>
    );
  }

  const extended = rentalExtendedData[rental.id] || { paidAmount: 0, debt: 0, comments: [], history: [] };
  const client = mockClients.find(c => c.company === rental.client);
  const equipmentList = mockEquipment.filter(e => rental.equipment.includes(e.inventoryNumber));
  const relatedDocs = mockDocuments.filter(d => d.rental === rental.id);
  const relatedPayments = mockPayments.filter(p => p.client === rental.client);
  const relatedService = mockServiceTickets.filter(t =>
    equipmentList.some(e => e.id === t.equipmentId)
  );

  const rentalDays = Math.ceil(
    (new Date(rental.plannedReturnDate).getTime() - new Date(rental.startDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const remainingBalance = rental.price - rental.discount - extended.paidAmount;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">{rental.id}</h1>
              {getRentalStatusBadge(rental.status)}
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{rental.client}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary">
            <Edit className="h-4 w-4" />
            Редактировать
          </Button>
          <Button variant="secondary">
            <FileText className="h-4 w-4" />
            Документы
          </Button>
        </div>
      </div>

      {rental.risk && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <p className="font-medium text-red-900 dark:text-red-200">Внимание</p>
            <p className="text-sm text-red-700 dark:text-red-300">{rental.risk}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="space-y-6 lg:col-span-2">
          {/* Client & Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-[--color-primary]" />
                Клиент
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Компания</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{rental.client}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Контактное лицо</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{rental.contact}</p>
                </div>
              </div>
              {client && (
                <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">ИНН</p>
                    <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-white">{client.inn}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Условия оплаты</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{client.paymentTerms}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Телефон</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{client.phone}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{client.email}</p>
                  </div>
                </div>
              )}
              {client && (
                <div className="pt-1">
                  <Link to={`/clients/${client.id}`} className="text-sm text-[--color-primary] hover:underline">
                    Перейти к карточке клиента →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equipment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-[--color-primary]" />
                Техника в аренде
              </CardTitle>
            </CardHeader>
            <CardContent>
              {equipmentList.length > 0 ? (
                <div className="space-y-3">
                  {equipmentList.map(eq => (
                    <Link
                      key={eq.id}
                      to={`/equipment/${eq.id}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-[--color-primary] hover:bg-gray-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-gray-700/50"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {eq.inventoryNumber} — {eq.model}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Серийный: {eq.serialNumber} · {eq.location}
                        </p>
                      </div>
                      <Badge variant={eq.status === 'rented' ? 'info' : eq.status === 'available' ? 'success' : 'default'}>
                        {eq.status === 'rented' ? 'В аренде' : eq.status === 'available' ? 'Свободна' : eq.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {rental.equipment.map(inv => (
                    <div key={inv} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium text-gray-900 dark:text-white">{inv}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dates & Duration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[--color-primary]" />
                Даты аренды
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата начала</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{formatDate(rental.startDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Плановый возврат</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{formatDate(rental.plannedReturnDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Длительность</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{rentalDays} дней</p>
                </div>
              </div>
              {rental.actualReturnDate && (
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Фактическая дата возврата</p>
                  <p className="mt-0.5 font-medium text-green-600">{formatDate(rental.actualReturnDate)}</p>
                </div>
              )}
              {rental.status === 'active' && (
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">До возврата</p>
                  <p className={`mt-0.5 font-medium ${getDaysUntil(rental.plannedReturnDate) < 0 ? 'text-red-600' : getDaysUntil(rental.plannedReturnDate) <= 3 ? 'text-yellow-600' : 'text-gray-900 dark:text-white'}`}>
                    {getDaysUntil(rental.plannedReturnDate) < 0
                      ? `Просрочен на ${Math.abs(getDaysUntil(rental.plannedReturnDate))} дн.`
                      : `${getDaysUntil(rental.plannedReturnDate)} дн.`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-[--color-primary]" />
                Комментарии
              </CardTitle>
              <CardDescription>{extended.comments.length} записей</CardDescription>
            </CardHeader>
            <CardContent>
              {extended.comments.length > 0 ? (
                <div className="space-y-3">
                  {extended.comments.map((c, idx) => (
                    <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">{c.author}</span>
                        <span>{formatDate(c.date)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{c.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет комментариев</p>
              )}
            </CardContent>
          </Card>

          {/* Related Service */}
          {relatedService.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-orange-500" />
                  Связанные сервисные заявки
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {relatedService.map(ticket => (
                    <Link
                      key={ticket.id}
                      to={`/service/${ticket.id}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-orange-300 hover:bg-orange-50/50 dark:border-gray-700 dark:hover:border-orange-600 dark:hover:bg-orange-900/10"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{ticket.id} — {ticket.reason}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{ticket.equipment}</p>
                      </div>
                      <Badge variant={
                        ticket.status === 'in_progress' ? 'info' :
                        ticket.status === 'waiting_parts' ? 'warning' :
                        ticket.status === 'new' ? 'default' : 'success'
                      }>
                        {ticket.status === 'in_progress' ? 'В работе' :
                         ticket.status === 'waiting_parts' ? 'Ожидание' :
                         ticket.status === 'new' ? 'Новая' : 'Готово'}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Financial Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[--color-primary]" />
                Финансы
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Стоимость аренды</p>
                <p className="mt-0.5 text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{rental.rate} · {rentalDays} дн.</p>
              </div>

              {rental.discount > 0 && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Скидка</span>
                    <span className="text-green-600">−{formatCurrency(rental.discount)}</span>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Итого к оплате</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(rental.price - rental.discount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Оплачено</span>
                    <span className="font-medium text-green-600">{formatCurrency(extended.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Остаток к оплате</span>
                    <span className={`font-medium ${remainingBalance > 0 ? 'text-orange-600' : 'text-gray-900 dark:text-white'}`}>
                      {formatCurrency(Math.max(remainingBalance, 0))}
                    </span>
                  </div>
                </div>
              </div>

              {extended.debt > 0 && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-red-600">Дебиторка</span>
                    <span className="font-medium text-red-600">{formatCurrency(extended.debt)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manager */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-[--color-primary]" />
                Менеджер
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {rental.manager.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{rental.manager}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Ответственный менеджер</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[--color-primary]" />
                Документы
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedDocs.length > 0 ? (
                <div className="space-y-2">
                  {relatedDocs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{doc.number}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {doc.type === 'contract' ? 'Договор' : doc.type === 'act' ? 'Акт' : 'Счёт'} · {formatDate(doc.date)}
                        </p>
                      </div>
                      <Badge variant={doc.status === 'signed' ? 'success' : doc.status === 'sent' ? 'info' : 'default'}>
                        {doc.status === 'signed' ? 'Подписан' : doc.status === 'sent' ? 'Отправлен' : 'Черновик'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет документов</p>
              )}
              {rental.documents && rental.documents.length > 0 && relatedDocs.length === 0 && (
                <div className="space-y-1.5">
                  {rental.documents.map((doc, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <CircleCheck className="h-4 w-4 text-green-500" />
                      {doc}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[--color-primary]" />
                История
              </CardTitle>
            </CardHeader>
            <CardContent>
              {extended.history.length > 0 ? (
                <div className="relative space-y-3 pl-4">
                  <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-200 dark:bg-gray-700" />
                  {extended.history.map((h, idx) => (
                    <div key={idx} className="relative">
                      <div className="absolute -left-[11px] top-1.5 h-2 w-2 rounded-full bg-[--color-primary]" />
                      <p className="text-sm text-gray-900 dark:text-white">{h.action}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(h.date)} · {h.user}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет записей</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}