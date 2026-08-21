import React from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  Plus,
  ReceiptText,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatCurrency, formatDate, formatDateTime } from '../../lib/utils';
import { buildRentalNewRoute } from '../../lib/rental-new-route.js';
import type { Client } from '../../types';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

type ClientDetailTabContentProps = {
  activeTab: string;
  model: any;
  client: Client;
  displayedDebt: number;
  canCreateRentals: boolean;
  canViewRentals: boolean;
  canViewPayments: boolean;
  canViewFinance: boolean;
  canViewDocuments: boolean;
  canCreateDocuments: boolean;
  canViewEquipment: boolean;
};

function withClientContext(path: string, client: Client, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (client.counterpartyId) params.set('counterpartyId', client.counterpartyId);
  if (client.id) params.set('clientId', client.id);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function rentalStatusLabel(status: string) {
  return ({
    new: 'Новая',
    created: 'Создана',
    confirmed: 'Подтверждена',
    delivery: 'Доставка',
    active: 'Активная',
    return_planned: 'Возврат',
    returned: 'Возвращена',
    closed: 'Закрыта',
    cancelled: 'Отменена',
  } as Record<string, string>)[status] || status || 'Без статуса';
}

function rentalStatusVariant(status: string): BadgeVariant {
  if (status === 'active') return 'success';
  if (['confirmed', 'created'].includes(status)) return 'info';
  if (['delivery', 'return_planned'].includes(status)) return 'warning';
  if (status === 'cancelled') return 'error';
  return 'default';
}

function paymentStatusLabel(status: string) {
  return ({
    paid: 'Оплачен',
    partial: 'Частично',
    overdue: 'Просрочен',
    pending: 'Ожидает',
    cancelled: 'Отменён',
  } as Record<string, string>)[status] || status || 'Без статуса';
}

function paymentStatusVariant(status: string): BadgeVariant {
  if (status === 'paid') return 'success';
  if (status === 'partial') return 'info';
  if (status === 'overdue') return 'error';
  return status === 'pending' ? 'warning' : 'default';
}

function documentStatusLabel(status: string) {
  return ({
    draft: 'Черновик',
    sent: 'Отправлен',
    pending_signature: 'Ждёт подписи',
    signed: 'Подписан',
    expired: 'Истёк',
    cancelled: 'Отменён',
    active: 'Активен',
    archived: 'Архив',
  } as Record<string, string>)[status] || status || 'Без статуса';
}

function documentTypeLabel(type: string) {
  return ({
    rental_contract: 'Договор аренды',
    rental_specification: 'Спецификация',
    transfer_act_to_client: 'Акт передачи',
    return_act_from_client: 'Акт возврата',
    contract: 'Договор',
    act: 'Акт',
    upd: 'УПД',
    invoice: 'Счёт',
    commercial_offer: 'Коммерческое предложение',
    service_act: 'Сервисный акт',
    work_order: 'Заказ-наряд',
  } as Record<string, string>)[type] || 'Документ';
}

function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
          <Icon className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
        {action}
      </CardContent>
    </Card>
  );
}

function RentalsTab(props: ClientDetailTabContentProps) {
  const { client, model, canCreateRentals, canViewRentals, canViewFinance } = props;
  if (!canViewRentals) {
    return <EmptyState icon={TrendingUp} title="Аренды скрыты правами доступа." />;
  }
  if (model.rentals.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="У клиента пока нет аренд"
        action={canCreateRentals ? (
          <Button asChild>
            <Link to={buildRentalNewRoute({ clientId: client.id })}><Plus className="h-4 w-4" />Создать аренду</Link>
          </Button>
        ) : undefined}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base">Аренды клиента</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Canonical Rental → Counterparty/Client, без копии данных в карточке.</p>
        </div>
        {canCreateRentals && (
          <Button asChild size="sm"><Link to={buildRentalNewRoute({ clientId: client.id })}><Plus className="h-4 w-4" />Новая аренда</Link></Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {model.rentals.map((rental: any) => (
          <article key={rental.id} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-gray-950 dark:text-white">
                    {rental.businessNumber ? `Аренда № ${rental.businessNumber}` : `Аренда ID ${rental.id}`}
                  </p>
                  <Badge variant={rentalStatusVariant(rental.status)}>{rentalStatusLabel(rental.status)}</Badge>
                </div>
                <p className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <CalendarDays className="h-4 w-4" />
                  {formatDate(rental.startDate)} — {formatDate(rental.endDate)}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {rental.equipment.map((item: any) => item.label).filter(Boolean).join(', ') || 'Техника не указана'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                {canViewFinance && <p className="font-semibold text-gray-950 dark:text-white">{formatCurrency(rental.amount)}</p>}
                {rental.navigationId ? (
                  <Button asChild variant="secondary" size="sm"><Link to={`/rentals/${encodeURIComponent(rental.navigationId)}`}>Открыть аренду</Link></Button>
                ) : (
                  <span className="text-xs text-amber-600 dark:text-amber-300">Карточка Rental не связана</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function PaymentsTab(props: ClientDetailTabContentProps) {
  const { client, model, displayedDebt, canViewPayments, canViewFinance } = props;
  if (!canViewPayments) {
    return <EmptyState icon={CreditCard} title="Платежи и суммы скрыты правами доступа." />;
  }
  if (model.payments.length === 0) {
    return <EmptyState icon={CreditCard} title="У клиента пока нет платежей" />;
  }

  return (
    <div className="space-y-4">
      {canViewFinance && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Текущая задолженность клиента</p>
              <p className="mt-1 text-2xl font-bold text-gray-950 dark:text-white">{formatCurrency(displayedDebt)}</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link to={withClientContext('/payments', client)}>Открыть регистр платежей</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">IncomingPayment и распределения</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {model.payments.map((payment: any) => (
            <article key={payment.id} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-950 dark:text-white">{payment.number}</p>
                    <Badge variant={paymentStatusVariant(payment.status)}>{paymentStatusLabel(payment.status)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{formatDate(payment.date)}</p>
                  {payment.rentalId && (
                    <p className="mt-1 text-xs text-gray-500">
                      Аренда: {payment.rentalBusinessNumber ? `№ ${payment.rentalBusinessNumber}` : payment.rentalId}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <p className="font-semibold text-gray-950 dark:text-white">{formatCurrency(payment.paidAmount || payment.amount)}</p>
                  {payment.paidAmount !== payment.amount && (
                    <p className="text-xs text-gray-500">Назначено: {formatCurrency(payment.amount)}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-900/70">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-gray-500">Распределено</span>
                  <span className="font-medium">{formatCurrency(payment.allocatedAmount)}</span>
                </div>
                {payment.unallocatedAmount > 0 && (
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-amber-700 dark:text-amber-300">
                    <span>Не распределено</span><span className="font-medium">{formatCurrency(payment.unallocatedAmount)}</span>
                  </div>
                )}
                {payment.allocations.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-gray-200 pt-3 dark:border-gray-800">
                    {payment.allocations.map((allocation: any) => (
                      <div key={allocation.id} className="flex flex-wrap justify-between gap-2 text-xs">
                        <span>
                          {allocation.rentalBusinessNumber ? `Аренда № ${allocation.rentalBusinessNumber}` : allocation.rentalId || allocation.documentId || 'Без назначения'}
                          {allocation.status !== 'active' ? ` · ${allocation.status}` : ''}
                        </span>
                        <span>{formatCurrency(allocation.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3">
                <Link className="text-sm font-medium text-primary-content hover:underline" to={withClientContext('/payments', client, { paymentId: payment.id })}>
                  Открыть платёж
                </Link>
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentsTab(props: ClientDetailTabContentProps) {
  const { client, model, canViewDocuments, canCreateDocuments } = props;
  if (!canViewDocuments) {
    return <EmptyState icon={FileText} title="Документы скрыты правами доступа." />;
  }
  const createPath = withClientContext('/documents', client, { action: 'create' });
  if (model.documents.length === 0 && model.contracts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="У клиента пока нет документов"
        action={canCreateDocuments ? <Button asChild><Link to={createPath}><Plus className="h-4 w-4" />Создать документ</Link></Button> : undefined}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div><CardTitle className="text-base">Документы и договоры клиента</CardTitle></div>
        {canCreateDocuments && <Button asChild size="sm"><Link to={createPath}><Plus className="h-4 w-4" />Создать документ</Link></Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        {model.documents.length > 0 && (
          <div className="space-y-3">
            {model.documents.map((document: any) => (
              <article key={document.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-950 dark:text-white">{document.number}</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{documentTypeLabel(document.type)} · {formatDate(document.date)}</p>
                  {document.rentalId && <p className="mt-1 text-xs text-gray-500">Аренда: {document.rentalBusinessNumber ? `№ ${document.rentalBusinessNumber}` : document.rentalId}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <Badge variant={document.status === 'signed' ? 'success' : document.status === 'sent' ? 'info' : 'default'}>{documentStatusLabel(document.status)}</Badge>
                  <Link className="text-sm font-medium text-primary-content hover:underline" to={withClientContext('/documents', client, { documentId: document.id })}>Открыть документ</Link>
                </div>
              </article>
            ))}
          </div>
        )}
        {model.contracts.length > 0 && (
          <div className="space-y-3 border-t border-gray-100 pt-5 dark:border-gray-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Договорные связи Counterparty</p>
            {model.contracts.map((contract: any) => (
              <div key={contract.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-gray-950 dark:text-white">{contract.number}</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{contract.title} · {formatDate(contract.date)}</p>
                </div>
                <Badge variant={contract.status === 'active' ? 'success' : 'default'}>{documentStatusLabel(contract.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentTab(props: ClientDetailTabContentProps) {
  const { model, canViewRentals, canViewEquipment } = props;
  if (!canViewRentals) {
    return <EmptyState icon={Truck} title="История техники скрыта правами доступа к арендам." />;
  }
  if (model.equipment.length === 0) {
    return <EmptyState icon={Truck} title="В арендной истории клиента пока нет техники" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Техника из арендной истории</CardTitle>
        <p className="text-sm text-muted-foreground">Source of truth — Rental; отдельная связь Client → Equipment не создаётся.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.equipment.map((equipment: any) => (
          <article key={equipment.key} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-950 dark:text-white">{equipment.label}</p>
                {equipment.inventoryNumber && <p className="mt-1 text-xs text-gray-500">INV {equipment.inventoryNumber}</p>}
              </div>
              <Badge variant={equipment.current ? 'success' : 'default'}>{equipment.current ? 'Сейчас у клиента' : 'Была ранее'}</Badge>
            </div>
            <div className="mt-4 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
              {equipment.rentals.map((rental: any) => (
                <div key={`${equipment.key}:${rental.id}`} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  {rental.navigationId ? (
                    <Link className="font-medium text-primary-content hover:underline" to={`/rentals/${encodeURIComponent(rental.navigationId)}`}>
                      {rental.businessNumber ? `Аренда № ${rental.businessNumber}` : `Аренда ${rental.id}`}
                    </Link>
                  ) : (
                    <span>{rental.businessNumber ? `Аренда № ${rental.businessNumber}` : `Аренда ${rental.id}`}</span>
                  )}
                  <span className="text-xs text-gray-500">{formatDate(rental.startDate)} — {formatDate(rental.endDate)}</span>
                </div>
              ))}
            </div>
            {canViewEquipment && equipment.equipmentId && (
              <div className="mt-3"><Link className="text-sm font-medium text-primary-content hover:underline" to={`/equipment/${encodeURIComponent(equipment.equipmentId)}`}>Открыть технику</Link></div>
            )}
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function ActivityTab(props: ClientDetailTabContentProps) {
  const { client, model } = props;
  if (model.activity.length === 0) {
    return <EmptyState icon={Clock} title="По клиенту пока нет зафиксированных событий" />;
  }

  const sourceLabel: Record<string, string> = {
    client: 'Клиент',
    rental: 'Аренда',
    document: 'Документ',
    payment: 'Платёж',
    crm: 'CRM',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">История активности</CardTitle>
        <p className="text-sm text-muted-foreground">Только сохранённые audit/history, CRM и факты проведённых платежей.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.activity.map((activity: any) => {
          const target = activity.source === 'rental' && activity.navigationId
            ? `/rentals/${encodeURIComponent(activity.navigationId)}`
            : activity.source === 'document'
              ? withClientContext('/documents', client, { documentId: activity.entityId })
              : activity.source === 'payment'
                ? withClientContext('/payments', client, { paymentId: activity.entityId })
                : '';
          return (
            <article key={activity.id} className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {activity.source === 'payment' ? <ReceiptText className="h-4 w-4" /> : activity.source === 'document' ? <FileText className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{sourceLabel[activity.source] || activity.source}</Badge>
                  <span className="text-xs text-gray-500">{formatDateTime(activity.date)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-950 dark:text-white">{activity.text}</p>
                <p className="mt-1 text-xs text-gray-500">{activity.author}</p>
                {target && <Link className="mt-2 inline-block text-sm font-medium text-primary-content hover:underline" to={target}>Открыть источник</Link>}
              </div>
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ClientDetailTabContent(props: ClientDetailTabContentProps) {
  let content: React.ReactNode = null;
  if (props.activeTab === 'rentals') content = <RentalsTab {...props} />;
  if (props.activeTab === 'payments') content = <PaymentsTab {...props} />;
  if (props.activeTab === 'documents') content = <DocumentsTab {...props} />;
  if (props.activeTab === 'equipment') content = <EquipmentTab {...props} />;
  if (props.activeTab === 'activity') content = <ActivityTab {...props} />;

  return (
    <section
      id={`client-tabpanel-${props.activeTab}`}
      role="tabpanel"
      aria-labelledby={`client-tab-${props.activeTab}`}
      tabIndex={0}
      data-client-tab-panel={props.activeTab}
    >
      {content}
    </section>
  );
}
