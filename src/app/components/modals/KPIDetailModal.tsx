import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarDays, ExternalLink, ListChecks, X, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { formatCurrency, formatDate } from '../../lib/utils';
import { animatedModalClassName, animatedOverlayClassName } from '../../lib/animations';

const metricCardClass = 'rounded-lg border border-border bg-card/85 p-4';
const mutedPanelClass = 'rounded-lg border border-border bg-muted/25 p-4';
const infoMetricClass = 'rounded-lg border border-primary/25 bg-primary/10 p-4';
const warningMetricClass = 'rounded-lg border border-warning/30 bg-warning/10 p-4';
const dangerMetricClass = 'rounded-lg border border-danger/30 bg-danger/10 p-4';
const successMetricClass = 'rounded-lg border border-success/25 bg-success/10 p-4';
const accentMetricClass = 'rounded-lg border border-info/25 bg-info/10 p-4';
const mutedMetricClass = 'rounded-lg border border-border bg-muted/35 p-4';
const linkCardClass = 'flex flex-col gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/35 hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between';
const dangerLinkCardClass = 'flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 transition-colors hover:border-danger/45 hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between';
const warningLinkCardClass = 'flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 transition-colors hover:border-warning/45 hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between';
const infoLinkCardClass = 'flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/10 p-3 transition-colors hover:border-primary/40 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between';

interface KPIDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpiType:
    | 'utilization'
    | 'activeRentals'
    | 'returnsTodayTomorrow'
    | 'overdueReturns'
    | 'idleEquipment'
    | 'openService'
    | 'unassignedService'
    | 'waitingParts'
    | 'repeatFailures'
    | 'serviceInDays'
    | 'weekRevenue'
    | 'totalDebt'
    | 'overdueDebt'
    | 'monthDebt'
    | null;
  data: any;
}

function kpiRowKey(prefix: string, row: any, index: number, ...fields: Array<string | number | null | undefined>) {
  const stablePart = [row?.id, row?.rentalId, row?.equipmentId, row?.clientId, ...fields]
    .filter(value => value !== undefined && value !== null && value !== '')
    .join('-');
  return stablePart ? `${prefix}-${stablePart}` : `${prefix}-${index}`;
}

function safeCurrency(value: unknown) {
  const amount = Number(value);
  return formatCurrency(Number.isFinite(amount) ? amount : 0);
}

function safeNumber(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function entityHref(section: string, id?: string | number | null, fallback = `/${section}`) {
  return id ? `/${section}/${id}` : fallback;
}

function utilizationEquipmentStatusLabel(status: unknown) {
  const value = String(status || '').trim();
  const labels: Record<string, string> = {
    available: 'Свободна',
    rented: 'В аренде',
    in_service: 'В сервисе',
    inactive: 'Неактивна',
    reserved: 'Резерв',
  };
  return labels[value] || value || 'Статус не указан';
}

export function KPIDetailModal({ open, onOpenChange, kpiType, data }: KPIDetailModalProps) {
  if (!kpiType) return null;

  const getContent = () => {
    switch (kpiType) {
      case 'utilization':
        const affectedEquipment = Array.isArray(data.affectedEquipment) ? data.affectedEquipment : [];
        const shownEquipment = affectedEquipment.slice(0, 12);
        const hiddenEquipmentCount = Math.max(0, affectedEquipment.length - shownEquipment.length);
        const activeEquipment = safeNumber(data.activeEquipment);
        const rentedEquipment = safeNumber(data.rentedEquipment);
        const excludedEquipment = safeNumber(data.excludedEquipment);
        const occupiedMachineDays = data.occupiedMachineDays === null || data.occupiedMachineDays === undefined
          ? null
          : safeNumber(data.occupiedMachineDays);
        const availableMachineDays = data.availableMachineDays === null || data.availableMachineDays === undefined
          ? null
          : safeNumber(data.availableMachineDays);
        const utilization = safeNumber(data.utilization);
        const detailLimited = occupiedMachineDays === null || availableMachineDays === null || affectedEquipment.length === 0;

        return {
          title: 'Как считается утилизация парка',
          description: 'Пояснение к KPI без перехода из дашборда: что вошло в расчёт, что исключено и как получился процент.',
          details: (
            <div className="space-y-4">
              <div className={mutedPanelClass}>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Период расчёта</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{data.periodLabel || 'Текущий расчётный срез'}</p>
                    {data.pagePeriodLabel && (
                      <p className="mt-1 text-sm text-muted-foreground">Период страницы: {data.pagePeriodLabel}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className={metricCardClass}>
                  <p className="text-sm text-muted-foreground">Всего техники</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{safeNumber(data.totalEquipment)}</p>
                </div>
                <div className={infoMetricClass}>
                  <p className="text-sm text-muted-foreground">Участвует в расчёте</p>
                  <p className="mt-1 text-2xl font-bold text-primary">{activeEquipment}</p>
                </div>
                {excludedEquipment > 0 && (
                  <div className={warningMetricClass}>
                    <p className="text-sm text-muted-foreground">Исключено из расчёта</p>
                    <p className="mt-1 text-2xl font-bold text-warning-foreground">{excludedEquipment}</p>
                  </div>
                )}
                <div className={successMetricClass}>
                  <p className="text-sm text-muted-foreground">В аренде / занятые машино-дни</p>
                  <p className="mt-1 text-2xl font-bold text-success-foreground">
                    {rentedEquipment} ед.{occupiedMachineDays !== null ? ` / ${occupiedMachineDays} м-дн.` : ''}
                  </p>
                </div>
                <div className={accentMetricClass}>
                  <p className="text-sm text-muted-foreground">Итоговый процент</p>
                  <p className="mt-1 text-2xl font-bold text-info-foreground">{utilization}%</p>
                </div>
              </div>

              <div className={mutedPanelClass}>
                <p className="text-sm font-medium text-foreground">Формула</p>
                <p className="mt-2 rounded-md bg-background/80 px-3 py-2 font-mono text-sm text-foreground">
                  Утилизация = занятые машино-дни / доступные машино-дни × 100%
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {occupiedMachineDays !== null && availableMachineDays !== null
                    ? `${occupiedMachineDays} / ${availableMachineDays} × 100% = ${utilization}%`
                    : 'Детализация машино-дней ограничена текущими данными.'}
                </p>
              </div>

              <div className={metricCardClass}>
                <p className="text-sm leading-6 text-foreground">
                  {activeEquipment > 0
                    ? `Из ${activeEquipment} единиц техники, доступных для арендного парка, ${rentedEquipment} сейчас занято в активной аренде. Поэтому KPI показывает ${utilization}% утилизации.`
                    : 'Активный арендный парк не сформирован, поэтому утилизация считается как 0%.'}
                </p>
                {detailLimited && (
                  <p className="mt-2 text-sm text-muted-foreground">Детализация ограничена текущими данными.</p>
                )}
              </div>

              {shownEquipment.length > 0 && (
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">Техника, повлиявшая на показатель</p>
                  </div>
                  <div className="divide-y divide-border sm:hidden">
                    {shownEquipment.map((equipment: any, index: number) => (
                      <div key={kpiRowKey('utilization-equipment-mobile', equipment, index, equipment?.inventoryNumber)} className="space-y-2 px-4 py-3">
                        <div>
                          <p className="font-medium text-foreground">{equipment.label || equipment.inventoryNumber || 'Техника'}</p>
                          <p className="text-xs text-muted-foreground">{equipment.inventoryNumber || equipment.equipmentId || 'без инв. номера'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                            {equipment.inRent ? (equipment.rentalClient ? `В аренде · ${equipment.rentalClient}` : 'В аренде') : utilizationEquipmentStatusLabel(equipment.status)}
                          </span>
                          <span className="rounded-md bg-primary/10 px-2 py-1 font-semibold text-primary">
                            {equipment.inRent ? `${safeNumber(equipment.occupiedMachineDays) || 1} м-дн.` : 'знаменатель'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="bg-muted/40 text-left text-xs font-semibold uppercase text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2">Техника</th>
                          <th className="px-4 py-2">Статус</th>
                          <th className="px-4 py-2">Вклад</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {shownEquipment.map((equipment: any, index: number) => (
                          <tr key={kpiRowKey('utilization-equipment', equipment, index, equipment?.inventoryNumber)}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{equipment.label || equipment.inventoryNumber || 'Техника'}</p>
                              <p className="text-xs text-muted-foreground">{equipment.inventoryNumber || equipment.equipmentId || 'без инв. номера'}</p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {equipment.inRent ? (equipment.rentalClient ? `В аренде · ${equipment.rentalClient}` : 'В аренде') : utilizationEquipmentStatusLabel(equipment.status)}
                            </td>
                            <td className="px-4 py-3 font-semibold text-foreground">
                              {equipment.inRent ? `${safeNumber(equipment.occupiedMachineDays) || 1} м-дн.` : 'знаменатель'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hiddenEquipmentCount > 0 && (
                    <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                      Ещё {hiddenEquipmentCount} ед. техники скрыто для компактности.
                    </p>
                  )}
                </div>
              )}
            </div>
          ),
          actions: (
            <>
              <Button variant="secondary" asChild>
                <Link to={data.plannerHref || '/planner'} onClick={() => onOpenChange(false)}>
                  Открыть в планировщике
                </Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to={data.rentalsHref || '/rentals'} onClick={() => onOpenChange(false)}>
                  Открыть аренды
                </Link>
              </Button>
            </>
          ),
        };

      case 'activeRentals':
        return {
          title: 'Активные аренды',
          description: 'Договоры аренды со статусом "Активен". Нажмите на аренду для просмотра деталей.',
          details: (
            <div className="space-y-3">
              <div className={infoMetricClass}>
                <p className="text-sm text-muted-foreground">Всего активных договоров</p>
                <p className="text-3xl font-bold text-primary">{data.activeRentals?.length || 0}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Список активных аренд:</p>
                {data.activeRentals?.slice(0, 10).map((rental: any, index: number) => (
                  <Link
                    key={kpiRowKey('active-rental', rental, index)}
                    to={rental.link || entityHref('rentals', rental.id)}
                    onClick={() => onOpenChange(false)}
                    className={linkCardClass}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{rental.client}</p>
                        <span className="text-xs text-muted-foreground">{rental.id || '—'}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {rental.equipment?.join(', ')} · {formatDate(rental.startDate)} — {formatDate(rental.plannedReturnDate)}
                      </p>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <p className="font-semibold text-foreground">{safeCurrency(rental.price)}</p>
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
              <div className={dangerMetricClass}>
                <p className="text-sm text-muted-foreground">Просроченных возвратов</p>
                <p className="text-3xl font-bold text-danger">{data.overdueRentals?.length || 0}</p>
              </div>
              {data.overdueRentals && data.overdueRentals.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Требуют внимания:</p>
                  {data.overdueRentals.map((rental: any, index: number) => (
                    <Link
                      key={kpiRowKey('overdue-rental', rental, index)}
                      to={rental.link || entityHref('rentals', rental.id)}
                      onClick={() => onOpenChange(false)}
                      className={dangerLinkCardClass}
                    >
                      <div>
                        <p className="font-medium text-foreground">{rental.client}</p>
                        <p className="text-sm text-danger">
                          Просрочен с {formatDate(rental.plannedReturnDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-danger/10 text-danger-foreground text-xs rounded">
                          Риск
                        </span>
                        <ExternalLink className="h-4 w-4 text-danger" />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                      <TrendingUp className="h-6 w-6 text-success" />
                    </div>
                    <p className="text-sm text-muted-foreground">Нет просроченных возвратов</p>
                  </div>
                </div>
              )}
            </div>
          )
        };

      case 'returnsTodayTomorrow':
        return {
          title: 'Возвраты сегодня и завтра',
          description: 'Ближайшие возвраты по активным арендам. Нажмите для перехода в планировщик.',
          details: (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className={warningMetricClass}>
                  <p className="text-sm text-muted-foreground">Сегодня</p>
                  <p className="text-2xl font-bold text-warning">{data.todayRentals?.length || 0}</p>
                </div>
                <div className={infoMetricClass}>
                  <p className="text-sm text-muted-foreground">Завтра</p>
                  <p className="text-2xl font-bold text-primary">{data.tomorrowRentals?.length || 0}</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Сегодня:</p>
                {data.todayRentals?.length ? data.todayRentals.map((rental: any, index: number) => (
                  <Link
                    key={kpiRowKey('today-rental', rental, index)}
                    to={rental.link || '/rentals'}
                    onClick={() => onOpenChange(false)}
                    className={warningLinkCardClass}
                  >
                    <div>
                      <p className="font-medium text-foreground">{rental.client}</p>
                      <p className="text-sm text-warning-foreground">
                        Возврат {formatDate(rental.plannedReturnDate)} · {rental.equipmentInv}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-warning" />
                  </Link>
                )) : (
                  <p className="text-sm text-muted-foreground">На сегодня возвратов нет</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Завтра:</p>
                {data.tomorrowRentals?.length ? data.tomorrowRentals.map((rental: any, index: number) => (
                  <Link
                    key={kpiRowKey('tomorrow-rental', rental, index)}
                    to={rental.link || '/rentals'}
                    onClick={() => onOpenChange(false)}
                    className={infoLinkCardClass}
                  >
                    <div>
                      <p className="font-medium text-foreground">{rental.client}</p>
                      <p className="text-sm text-primary">
                        Возврат {formatDate(rental.plannedReturnDate)} · {rental.equipmentInv}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-primary" />
                  </Link>
                )) : (
                  <p className="text-sm text-muted-foreground">На завтра возвратов нет</p>
                )}
              </div>
            </div>
          )
        };

      case 'idleEquipment':
        return {
          title: 'Техника в простое',
          description: 'Техника, которая не занята в аренде и не зарезервирована.',
          details: (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className={successMetricClass}>
                  <p className="text-sm text-muted-foreground">Свободно</p>
                  <p className="text-2xl font-bold text-success">{data.availableCount || 0}</p>
                </div>
                <div className={mutedMetricClass}>
                  <p className="text-sm text-muted-foreground">Неактивно</p>
                  <p className="text-2xl font-bold text-foreground">{data.inactiveCount || 0}</p>
                </div>
              </div>
              <div className="space-y-2">
                {data.idleEquipment?.length ? data.idleEquipment.map((equipment: any, index: number) => (
                  <Link
                    key={kpiRowKey('idle-equipment', equipment, index, equipment?.inventoryNumber)}
                    to={entityHref('equipment', equipment.id)}
                    onClick={() => onOpenChange(false)}
                    className={linkCardClass}
                  >
                    <div>
                      <p className="font-medium text-foreground">{equipment.manufacturer} {equipment.model}</p>
                      <p className="text-sm text-muted-foreground">
                        {equipment.inventoryNumber} · {equipment.status === 'inactive' ? 'Неактивна' : 'Свободна'}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                  </Link>
                )) : (
                  <p className="text-sm text-muted-foreground">В простое техники нет</p>
                )}
              </div>
            </div>
          )
        };

      case 'openService':
        return {
          title: 'Открытые сервисные заявки',
          description: 'Все незакрытые заявки сервиса. Нажмите для перехода к карточке заявки.',
          details: (
            <div className="space-y-3">
              <div className={warningMetricClass}>
                <p className="text-sm text-muted-foreground">Открытых заявок</p>
                <p className="text-3xl font-bold text-warning">{data.openTickets?.length || 0}</p>
              </div>
              {data.openTickets && data.openTickets.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Список заявок:</p>
                  {data.openTickets.map((ticket: any, index: number) => (
                    <Link
                      key={kpiRowKey('open-ticket', ticket, index)}
                      to={entityHref('service', ticket.id)}
                      onClick={() => onOpenChange(false)}
                      className={linkCardClass}
                    >
                      <div>
                        <p className="font-medium text-foreground">{ticket.equipment}</p>
                        <p className="text-sm text-muted-foreground">
                          {ticket.reason} · {ticket.assignedMechanicName || ticket.assignedTo || 'Без механика'}
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

      case 'unassignedService':
        return {
          title: 'Заявки без механика',
          description: 'Открытые заявки, которым ещё не назначен исполнитель.',
          details: (
            <div className="space-y-3">
              <div className={dangerMetricClass}>
                <p className="text-sm text-muted-foreground">Без механика</p>
                <p className="text-3xl font-bold text-danger">{data.unassignedTickets?.length || 0}</p>
              </div>
              {data.unassignedTickets?.length ? data.unassignedTickets.map((ticket: any, index: number) => (
                <Link
                  key={kpiRowKey('unassigned-ticket', ticket, index)}
                  to={entityHref('service', ticket.id)}
                  onClick={() => onOpenChange(false)}
                  className={dangerLinkCardClass}
                >
                  <div>
                    <p className="font-medium text-foreground">{ticket.equipment}</p>
                    <p className="text-sm text-danger-foreground">{ticket.reason}</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-danger" />
                </Link>
              )) : (
                <p className="text-sm text-success-foreground">Все заявки распределены</p>
              )}
            </div>
          )
        };

      case 'waitingParts':
        return {
          title: 'Заявки, ожидающие запчасти',
          description: 'Заявки в статусе ожидания запчастей.',
          details: (
            <div className="space-y-3">
              <div className={warningMetricClass}>
                <p className="text-sm text-muted-foreground">Ждут запчасти</p>
                <p className="text-3xl font-bold text-warning">{data.waitingTickets?.length || 0}</p>
              </div>
              {data.waitingTickets?.length ? data.waitingTickets.map((ticket: any, index: number) => (
                <Link
                  key={kpiRowKey('waiting-ticket', ticket, index)}
                  to={entityHref('service', ticket.id)}
                  onClick={() => onOpenChange(false)}
                  className={warningLinkCardClass}
                >
                  <div>
                    <p className="font-medium text-foreground">{ticket.equipment}</p>
                    <p className="text-sm text-warning-foreground">{ticket.reason}</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-warning" />
                </Link>
              )) : (
                <p className="text-sm text-success-foreground">Ожидания запчастей нет</p>
              )}
            </div>
          )
        };

      case 'repeatFailures':
        return {
          title: 'Повторные поломки',
          description: 'Техника с повторяющейся причиной обращения в сервис.',
          details: (
            <div className="space-y-3">
              <div className={dangerMetricClass}>
                <p className="text-sm text-muted-foreground">Повторных случаев</p>
                <p className="text-3xl font-bold text-danger">{data.repeatFailures?.length || 0}</p>
              </div>
              {data.repeatFailures?.length ? data.repeatFailures.map((row: any, index: number) => (
                <Link
                  key={kpiRowKey('repeat-failure', row, index, row?.reason)}
                  to={row.equipmentId ? `/equipment/${row.equipmentId}` : '/reports'}
                  onClick={() => onOpenChange(false)}
                  className={dangerLinkCardClass}
                >
                  <div>
                    <p className="font-medium text-foreground">{row.equipmentLabel}</p>
                    <p className="text-sm text-danger-foreground">
                      {row.reason} · {row.repairsCount} ремонтов
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-danger" />
                </Link>
              )) : (
                <p className="text-sm text-success-foreground">Повторные поломки не найдены</p>
              )}
            </div>
          )
        };

      case 'serviceInDays':
        return {
          title: 'Техника в сервисе по дням',
          description: 'Открытые сервисные заявки с длительностью нахождения техники в сервисе.',
          details: (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className={warningMetricClass}>
                  <p className="text-sm text-muted-foreground">Техника в сервисе</p>
                  <p className="text-2xl font-bold text-warning">{data.equipmentInService?.length || 0}</p>
                </div>
                <div className={infoMetricClass}>
                  <p className="text-sm text-muted-foreground">Средний срок</p>
                  <p className="text-2xl font-bold text-primary">{data.averageDays || 0} дн.</p>
                </div>
                <div className={dangerMetricClass}>
                  <p className="text-sm text-muted-foreground">Максимум</p>
                  <p className="text-2xl font-bold text-danger">{data.maxDays || 0} дн.</p>
                </div>
              </div>
              <div className="space-y-2">
                {data.rows?.length ? data.rows.map((row: any, index: number) => (
                  <Link
                    key={kpiRowKey('service-days', row, index, row?.inventoryNumber)}
                    to={entityHref('service', row.id)}
                    onClick={() => onOpenChange(false)}
                    className={linkCardClass}
                  >
                    <div>
                      <p className="font-medium text-foreground">{row.equipmentLabel}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.reason} · {row.inventoryLabel || row.inventoryNumber}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-warning">{row.daysInService} дн.</span>
                      <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                    </div>
                  </Link>
                )) : (
                  <p className="text-sm text-success-foreground">Открытых сервисных заявок нет</p>
                )}
              </div>
            </div>
          )
        };

      case 'weekRevenue':
        return {
          title: 'Выручка за неделю',
          description: 'Доход от активных договоров аренды',
          details: (
            <div className="space-y-4">
              <div className={successMetricClass}>
                <p className="text-sm text-muted-foreground">Общая выручка</p>
                <p className="text-3xl font-bold text-success">{safeCurrency(data.weekRevenue)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
                  <p className="text-xs text-muted-foreground">Активных договоров</p>
                  <p className="text-xl font-bold text-foreground">{data.activeRentalsCount}</p>
                </div>
                <div className="rounded-lg border border-info/25 bg-info/10 p-3">
                  <p className="text-xs text-muted-foreground">Средний чек</p>
                  <p className="text-xl font-bold text-foreground">
                    {safeCurrency(data.averagePrice)}
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
              <div className={warningMetricClass}>
                <p className="text-sm text-muted-foreground">Общая дебиторка</p>
                <p className="text-3xl font-bold text-warning">{safeCurrency(data.totalDebt)}</p>
              </div>
              {data.clients && data.clients.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Клиенты с задолженностью:</p>
                  {data.clients.map((client: any, index: number) => (
                    <Link
                      key={kpiRowKey('debt-client', client, index, client?.company)}
                      to={entityHref('clients', client.id)}
                      onClick={() => onOpenChange(false)}
                      className={linkCardClass}
                    >
                      <div>
                        <p className="font-medium text-foreground">{client.company}</p>
                        <p className="text-sm text-muted-foreground">{client.contact}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-warning">{safeCurrency(client.debt)}</p>
                        <ExternalLink className="h-4 w-4 text-[--color-primary]" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {data.overduePayments && data.overduePayments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Просроченные платежи:</p>
                  {data.overduePayments.map((p: any, index: number) => (
                    <div key={kpiRowKey('total-debt-payment', p, index, p?.invoiceNumber)} className={dangerLinkCardClass}>
                      <div>
                        <p className="font-medium text-foreground">{p.client}</p>
                        <p className="text-sm text-danger">
                          {p.invoiceNumber || `Аренда ${p.rentalId}`} · Срок: {formatDate(p.dueDate || p.expectedPaymentDate || p.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold text-danger">{safeCurrency(p.outstanding ?? p.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        };

      case 'overdueDebt':
        return {
          title: 'Просроченная дебиторская задолженность',
          description: 'Открытый долг по арендам, где ожидаемая дата оплаты или дата окончания уже прошла.',
          details: (
            <div className="space-y-4">
              <div className={dangerMetricClass}>
                <p className="text-sm text-muted-foreground">Просроченная дебиторка</p>
                <p className="text-3xl font-bold text-danger">{safeCurrency(data.overdueDebt)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{safeNumber(data.overdueClients)} клиентов</p>
              </div>
              {data.overduePayments && data.overduePayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Просроченные аренды:</p>
                  {data.overduePayments.map((p: any, index: number) => (
                    <div key={kpiRowKey('overdue-debt-payment', p, index, p?.invoiceNumber)} className={dangerLinkCardClass}>
                      <div>
                        <p className="font-medium text-foreground">{p.client}</p>
                        <p className="text-sm text-danger">
                          {p.invoiceNumber || `Аренда ${p.rentalId}`} · Срок: {formatDate(p.dueDate || p.expectedPaymentDate || p.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold text-danger">{safeCurrency(p.outstanding ?? p.amount)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                      <TrendingUp className="h-6 w-6 text-success" />
                    </div>
                    <p className="text-sm text-muted-foreground">Просроченной дебиторки нет</p>
                  </div>
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
              <div className={dangerMetricClass}>
                <p className="text-sm text-muted-foreground">Дебиторка за месяц</p>
                <p className="text-3xl font-bold text-danger">{safeCurrency(data.monthDebt)}</p>
              </div>
              {data.overduePayments && data.overduePayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Просроченные платежи:</p>
                  {data.overduePayments.map((p: any, index: number) => (
                    <div key={kpiRowKey('month-debt-payment', p, index, p?.invoiceNumber)} className={dangerLinkCardClass}>
                      <div>
                        <p className="font-medium text-foreground">{p.client}</p>
                        <p className="text-sm text-danger">
                          {p.invoiceNumber || `Аренда ${p.rentalId}`} · Срок: {formatDate(p.dueDate || p.expectedPaymentDate || p.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold text-danger">{safeCurrency(p.outstanding ?? p.amount)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                      <TrendingUp className="h-6 w-6 text-success" />
                    </div>
                    <p className="text-sm text-muted-foreground">Нет просроченных платежей</p>
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
        <Dialog.Overlay className={animatedOverlayClassName()} />
        <Dialog.Content className={animatedModalClassName('flex !max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-2xl flex-col overflow-hidden border-border bg-card p-0 text-card-foreground')}>
          <div className="shrink-0 border-b border-border bg-card/95 px-6 py-5 pr-14">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-xl font-semibold text-foreground">
                {content.title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
              {content.description}
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 pr-5">{content.details}</div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card/95 px-6 py-4 backdrop-blur">
            {content.actions}
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
