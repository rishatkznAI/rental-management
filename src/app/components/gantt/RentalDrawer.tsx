import React from 'react';
import { X, Calendar, CreditCard, FileText, User, MessageSquare, ArrowRight, RotateCcw, CirclePause as PauseCircle, CircleCheck, CircleAlert, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { GanttRentalData } from '../../mock-data';
import type { Equipment } from '../../types';

interface RentalDrawerProps {
  rental: GanttRentalData | null;
  equipment: Equipment | undefined;
  onClose: () => void;
  onReturn: (rental: GanttRentalData) => void;
  onStatusChange: (rental: GanttRentalData) => void;
}

const statusLabels: Record<GanttRentalData['status'], string> = {
  created: 'Создана',
  active: 'В аренде',
  returned: 'Возвращена',
  closed: 'Закрыта',
};

const statusVariants: Record<GanttRentalData['status'], 'default' | 'info' | 'success' | 'warning'> = {
  created: 'default',
  active: 'info',
  returned: 'success',
  closed: 'default',
};

const paymentLabels: Record<GanttRentalData['paymentStatus'], string> = {
  paid: 'Оплачено',
  unpaid: 'Не оплачено',
  partial: 'Частично',
};

const paymentVariants: Record<GanttRentalData['paymentStatus'], 'success' | 'error' | 'warning'> = {
  paid: 'success',
  unpaid: 'error',
  partial: 'warning',
};

export function RentalDrawer({ rental, equipment, onClose, onReturn, onStatusChange }: RentalDrawerProps) {
  if (!rental) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      
      {/* Drawer */}
      <div className="relative z-10 flex w-[38%] min-w-[420px] max-w-[600px] flex-col bg-white shadow-2xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 p-5 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg text-gray-900 dark:text-white">{rental.client}</h2>
              <Badge variant={statusVariants[rental.status]}>{statusLabels[rental.status]}</Badge>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span className="font-mono">{rental.id}</span>
              <span>·</span>
              <span>{rental.equipmentInv} {equipment?.model}</span>
            </div>
          </div>
          <button onClick={onClose} className="ml-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Dates */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Calendar className="h-4 w-4" />
              <span>Даты аренды</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-xs text-gray-500">Начало</div>
                  <div className="text-sm text-gray-900 dark:text-white">{formatDate(rental.startDate)}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Окончание</div>
                  <div className="text-sm text-gray-900 dark:text-white">{formatDate(rental.endDate)}</div>
                </div>
                <div className="ml-auto">
                  <div className="text-xs text-gray-500">Дней</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {Math.ceil((new Date(rental.endDate).getTime() - new Date(rental.startDate).getTime()) / (1000 * 60 * 60 * 24))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Payment */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <CreditCard className="h-4 w-4" />
              <span>Оплата</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant={paymentVariants[rental.paymentStatus]}>
                    {paymentLabels[rental.paymentStatus]}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-lg text-gray-900 dark:text-white">{formatCurrency(rental.amount)}</div>
                </div>
              </div>
              {rental.expectedPaymentDate && (
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>Ожидаемая оплата: {formatDate(rental.expectedPaymentDate)}</span>
                </div>
              )}
            </div>
          </section>

          {/* Documents */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <FileText className="h-4 w-4" />
              <span>Документы</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">УПД</span>
                <div className="flex items-center gap-2">
                  {rental.updSigned ? (
                    <>
                      <CircleCheck className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700 dark:text-green-400">Подписан</span>
                      {rental.updDate && <span className="text-xs text-gray-500">({formatDate(rental.updDate)})</span>}
                    </>
                  ) : (
                    <>
                      <CircleAlert className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600 dark:text-red-400">Не подписан</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Manager */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <User className="h-4 w-4" />
              <span>Ответственный менеджер</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {rental.managerInitials}
                </div>
                <span className="text-sm text-gray-900 dark:text-white">{rental.manager}</span>
              </div>
            </div>
          </section>

          {/* Comments / History */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <MessageSquare className="h-4 w-4" />
              <span>История изменений</span>
            </div>
            <div className="space-y-2">
              {rental.comments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-sm text-gray-400 dark:border-gray-700">
                  Нет записей
                </div>
              ) : (
                rental.comments.map((comment, idx) => (
                  <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{comment.author}</span>
                      <span>{formatDate(comment.date)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{comment.text}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <Button size="sm" onClick={() => onStatusChange(rental)}>
            <ArrowRight className="h-3.5 w-3.5" />
            Сменить статус
          </Button>
          {rental.status === 'active' && (
            <Button size="sm" variant="secondary" onClick={() => onReturn(rental)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Возврат техники
            </Button>
          )}
          {rental.status === 'returned' && (
            <Button size="sm" variant="secondary" onClick={() => onStatusChange(rental)}>
              <CircleCheck className="h-3.5 w-3.5" />
              Закрыть аренду
            </Button>
          )}
          <Button size="sm" variant="ghost">
            <PauseCircle className="h-3.5 w-3.5" />
            Создать простой
          </Button>
        </div>
      </div>
    </div>
  );
}