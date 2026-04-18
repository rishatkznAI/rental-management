import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, TrendingUp, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { formatCurrency, formatDate } from '../../lib/utils';

interface KPIDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpiType: 'utilization' | 'activeRentals' | 'overdueReturns' | 'inService' | 'weekRevenue' | 'totalDebt' | 'monthDebt' | null;
  data: any;
}

export function KPIDetailModal({ open, onOpenChange, kpiType, data }: KPIDetailModalProps) {
  if (!kpiType) return null;

  const getContent = () => {
    switch (kpiType) {
      case 'utilization':
        return {
          title: 'Утилизация парка за текущий месяц',
          description: 'Процент техники, находящейся в активной аренде в текущем месяце',
          details: (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Всего единиц</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalEquipment}</p>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-400">В аренде</p>
                  <p className="text-2xl font-bold text-green-600">{data.rentedEquipment}</p>
                </div>
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Свободно</p>
                  <p className="text-2xl font-bold text-yellow-600">{data.availableEquipment}</p>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Утилизация (месяц)</p>
                  <p className="text-2xl font-bold text-purple-600">{data.utilization}%</p>
                </div>
              </div>
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Расчёт утилизации за месяц:</p>
                <p className="text-sm text-gray-900 dark:text-white font-mono">
                  ({data.rentedEquipment} / {data.totalEquipment}) × 100 = {data.utilization}%
                </p>
              </div>
            </div>
          )
        };

      case 'activeRentals':
        return {
          title: 'Активные аренды',
          description: 'Договоры аренды со статусом "Активен". Нажмите на аренду для просмотра деталей.',
          details: (
            <div className="space-y-3">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Всего активных договоров</p>
                <p className="text-3xl font-bold text-blue-600">{data.activeRentals?.length || 0}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Список активных аренд:</p>
                {data.activeRentals?.slice(0, 10).map((rental: any) => (
                  <Link
                    key={rental.id}
                    to={`/rentals/${rental.id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-[--color-primary] hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white">{rental.client}</p>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{rental.id}</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {rental.equipment?.join(', ')} · {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                      </p>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                      <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        };

      case 'overdueReturns':
        return {
          title: 'Просроченные возвраты',
          description: 'Аренды с истёкшим сроком возврата. Нажмите для перехода к деталям.',
          details: (
            <div className="space-y-3">
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Просроченных возвратов</p>
                <p className="text-3xl font-bold text-red-600">{data.overdueRentals?.length || 0}</p>
              </div>
              {data.overdueRentals && data.overdueRentals.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Требуют внимания:</p>
                  {data.overdueRentals.map((rental: any) => (
                    <Link
                      key={rental.id}
                      to={`/rentals/${rental.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 transition-colors hover:border-red-400 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:hover:border-red-600 dark:hover:bg-red-900/40"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{rental.client}</p>
                        <p className="text-sm text-red-600">
                          Просрочен с {formatDate(rental.plannedReturnDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 text-xs rounded">
                          Риск
                        </span>
                        <ExternalLink className="h-4 w-4 text-red-600" />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                    <p className="text-sm text-gray-500">Нет просроченных возвратов</p>
                  </div>
                </div>
              )}
            </div>
          )
        };

      case 'inService':
        return {
          title: 'Техника в сервисе',
          description: 'Оборудование, находящееся на обслуживании',
          details: (
            <div className="space-y-3">
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Единиц в сервисе</p>
                <p className="text-3xl font-bold text-orange-600">{data.equipmentInService?.length || 0}</p>
              </div>
              {data.equipmentInService && data.equipmentInService.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Список техники:</p>
                  {data.equipmentInService.map((equipment: any) => (
                    <Link
                      key={equipment.id}
                      to={`/equipment/${equipment.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-[--color-primary] hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{equipment.model}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {equipment.inventoryNumber} · Серийный: {equipment.serialNumber}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        };

      case 'weekRevenue':
        return {
          title: 'Выручка за неделю',
          description: 'Доход от активных договоров аренды',
          details: (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Общая выручка</p>
                <p className="text-3xl font-bold text-green-600">{formatCurrency(data.weekRevenue)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400">Активных договоров</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{data.activeRentalsCount}</p>
                </div>
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400">Средний чек</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatCurrency(data.averagePrice)}
                  </p>
                </div>
              </div>
            </div>
          )
        };

      case 'totalDebt':
        return {
          title: 'Общая дебиторская задолженность',
          description: 'Суммарная задолженность всех клиентов',
          details: (
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Общая дебиторка</p>
                <p className="text-3xl font-bold text-orange-600">{formatCurrency(data.totalDebt)}</p>
              </div>
              {data.clients && data.clients.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Клиенты с задолженностью:</p>
                  {data.clients.map((client: any) => (
                    <Link
                      key={client.id}
                      to={`/clients/${client.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-[--color-primary] hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{client.company}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{client.contact}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-orange-600">{formatCurrency(client.debt)}</p>
                        <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {data.overduePayments && data.overduePayments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Просроченные платежи:</p>
                  {data.overduePayments.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{p.client}</p>
                        <p className="text-sm text-red-600">
                          {p.invoiceNumber || `Аренда ${p.rentalId}`} · Срок: {formatDate(p.dueDate || p.expectedPaymentDate || p.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold text-red-600">{formatCurrency(p.outstanding ?? p.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        };

      case 'monthDebt':
        return {
          title: 'Дебиторка за текущий месяц',
          description: 'Просроченные платежи за текущий месяц',
          details: (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Дебиторка за месяц</p>
                <p className="text-3xl font-bold text-red-600">{formatCurrency(data.monthDebt)}</p>
              </div>
              {data.overduePayments && data.overduePayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Просроченные платежи:</p>
                  {data.overduePayments.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{p.client}</p>
                        <p className="text-sm text-red-600">
                          {p.invoiceNumber || `Аренда ${p.rentalId}`} · Срок: {formatDate(p.dueDate || p.expectedPaymentDate || p.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold text-red-600">{formatCurrency(p.outstanding ?? p.amount)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                    <p className="text-sm text-gray-500">Нет просроченных платежей</p>
                  </div>
                </div>
              )}
            </div>
          )
        };

      default:
        return null;
    }
  };

  const content = getContent();
  if (!content) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white dark:bg-gray-800 p-6 shadow-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <Dialog.Title className="text-2xl font-bold text-gray-900 dark:text-white">
              {content.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {content.description}
          </Dialog.Description>

          <div>{content.details}</div>

          <div className="flex justify-end mt-6">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
