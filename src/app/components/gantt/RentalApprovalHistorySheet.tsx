import React from 'react';
import { ArrowRight, Check, Clock, FileText, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { Textarea } from '../ui/textarea';
import { useAuth } from '../../contexts/AuthContext';
import { useClientsList } from '../../hooks/useClients';
import { useEquipmentList } from '../../hooks/useEquipment';
import {
  useApproveRentalChangeRequest,
  useRejectRentalChangeRequest,
} from '../../hooks/useRentalChangeRequests';
import { useRentalsList } from '../../hooks/useRentals';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import type { Client, Equipment, Rental, RentalChangeRequest, RentalChangeRequestStatus } from '../../types';

const statusLabels: Record<RentalChangeRequestStatus, string> = {
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
};

const summaryCardClass = 'rounded-lg border border-border bg-muted/25 p-3';
const pendingSummaryCardClass = 'rounded-lg border border-warning/30 bg-warning/10 p-3';
const approvedSummaryCardClass = 'rounded-lg border border-success/25 bg-success/10 p-3';
const rejectedSummaryCardClass = 'rounded-lg border border-danger/30 bg-danger/10 p-3';
const errorPanelClass = 'rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger-foreground';
const requestCardClass = 'rounded-lg border border-border bg-card p-4 shadow-sm';
const changePanelClass = 'rounded-lg border border-border bg-muted/25 p-3';
const labelTextClass = 'text-xs text-muted-foreground';
const valueTextClass = 'font-medium text-foreground';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.number) return String(record.number);
    if (record.invoiceNumber) return String(record.invoiceNumber);
    return JSON.stringify(value);
  }
  return String(value);
}

function statusBadge(status: RentalChangeRequestStatus) {
  if (status === 'approved') return <Badge variant="success">{statusLabels[status]}</Badge>;
  if (status === 'rejected') return <Badge variant="error">{statusLabels[status]}</Badge>;
  return <Badge variant="warning">{statusLabels[status]}</Badge>;
}

function statusIcon(status: RentalChangeRequestStatus) {
  if (status === 'approved') return <Check className="h-4 w-4 text-success" />;
  if (status === 'rejected') return <X className="h-4 w-4 text-danger" />;
  return <Clock className="h-4 w-4 text-warning" />;
}

function financialImpact(request: RentalChangeRequest) {
  const amount = request.financialImpact?.amount ?? 0;
  if (amount === 0) return request.financialImpact?.description || 'Без прямого изменения суммы';
  return `${amount > 0 ? '+' : ''}${formatCurrency(amount)}`;
}

function normalizeEquipmentRef(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

function equipmentMatchesRef(equipment: Equipment, ref: string) {
  const normalized = normalizeEquipmentRef(ref);
  if (!normalized) return false;
  return [
    equipment.id,
    equipment.inventoryNumber,
    equipment.serialNumber,
  ].some(value => normalizeEquipmentRef(value) === normalized);
}

function buildEquipmentTitle(equipment: Equipment, fallbackRef = '') {
  const title = [
    equipment.manufacturer,
    equipment.model,
  ].filter(Boolean).join(' ').trim() || fallbackRef || equipment.id;
  const meta = [
    equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
    equipment.serialNumber ? `SN ${equipment.serialNumber}` : '',
  ].filter(Boolean).join(' · ');
  return meta ? `${title} · ${meta}` : title;
}

function resolveRentalForRequest(request: RentalChangeRequest, rentals: Rental[]) {
  if (!request.rentalId) return null;
  return rentals.find(item => item.id === request.rentalId) || null;
}

function resolveClientDisplay(rental: Rental | null, request: RentalChangeRequest, clients: Client[]) {
  if (!rental) return 'Аренда не найдена';
  if (rental.clientId) {
    const client = clients.find(item => item.id === rental.clientId);
    if (!client) return 'Не найдено';
    return client.company || 'Не найдено';
  }
  return rental.client || 'Не найдено';
}

function resolveEquipmentDisplayItemsForRental(rental: Rental | null, equipmentList: Equipment[]) {
  if (!rental) return ['Аренда не найдена'];
  const refs = Array.isArray(rental.equipment) ? rental.equipment : [];
  if (refs.length === 0) return ['Не найдено'];

  return refs.map((ref) => {
    const matched = equipmentList.find(item => equipmentMatchesRef(item, ref));
    return matched ? buildEquipmentTitle(matched, ref) : 'Не найдено';
  });
}
function getRequestDecisionText(request: RentalChangeRequest): string {
  if (request.status === 'approved') {
    return `Согласовал: ${request.decidedByName || '—'}${request.appliedAt ? ` · применено ${formatDateTime(request.appliedAt)}` : ''}`;
  }
  if (request.status === 'rejected') {
    return `Отклонил: ${request.decidedByName || '—'} · причина: ${request.rejectionReason || '—'}`;
  }
  return 'Ожидает решения администратора';
}

function getRequestChanges(request: RentalChangeRequest) {
  if (request.changes?.length) {
    return request.changes.map(change => ({
      field: change.field,
      label: change.label || request.fieldLabel || change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
    }));
  }

  return [{
    field: request.field,
    label: request.fieldLabel || request.field,
    oldValue: request.oldValue,
    newValue: request.newValue,
  }];
}

interface RentalApprovalHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: RentalChangeRequest[];
  isLoading?: boolean;
  error?: unknown;
}

export function RentalApprovalHistorySheet({
  open,
  onOpenChange,
  requests,
  isLoading = false,
  error,
}: RentalApprovalHistorySheetProps) {
  const { user } = useAuth();
  const { data: equipmentList = [] } = useEquipmentList({ enabled: open });
  const { data: rentals = [] } = useRentalsList({ enabled: open });
  const { data: clients = [] } = useClientsList({ enabled: open });
  const approveMutation = useApproveRentalChangeRequest();
  const rejectMutation = useRejectRentalChangeRequest();
  const [rejecting, setRejecting] = React.useState<RentalChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const pendingCount = requests.filter(item => item.status === 'pending').length;
  const approvedCount = requests.filter(item => item.status === 'approved').length;
  const rejectedCount = requests.filter(item => item.status === 'rejected').length;
  const isAdmin = String(user?.role || '').trim() === 'Администратор';
  const rentalByRequestId = React.useMemo(() => (
    new Map(requests.map(request => [request.id, resolveRentalForRequest(request, rentals)]))
  ), [rentals, requests]);
  const equipmentDisplayByRequestId = React.useMemo(() => (
    new Map(requests.map(request => [
      request.id,
      resolveEquipmentDisplayItemsForRental(rentalByRequestId.get(request.id) || null, equipmentList),
    ]))
  ), [equipmentList, rentalByRequestId, requests]);

  const renderEquipmentList = (request: RentalChangeRequest) => {
    const items = equipmentDisplayByRequestId.get(request.id) || ['—'];
    return (
      <div className="space-y-1">
        {items.map((item, index) => (
          <p key={`${request.id}:equipment:${index}`} className={valueTextClass}>
            {item}
          </p>
        ))}
      </div>
    );
  };

  const handleApprove = async (request: RentalChangeRequest) => {
    setActionError(null);
    try {
      await approveMutation.mutateAsync({ id: request.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не удалось согласовать заявку.');
    }
  };

  const startReject = (request: RentalChangeRequest) => {
    setActionError(null);
    setRejecting(request);
    setRejectReason('');
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setActionError(null);
    try {
      await rejectMutation.mutateAsync({ id: rejecting.id, reason: rejectReason });
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не удалось отклонить заявку.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col bg-card text-card-foreground sm:max-w-3xl">
        <SheetHeader className="border-b border-border bg-card/95 pb-4">
          <SheetTitle className="flex items-center gap-2 text-xl text-foreground">
            <FileText className="h-5 w-5 text-[--color-primary]" />
            Согласования аренды
          </SheetTitle>
          <SheetDescription>
            История заявок на защищённые изменения карточек аренды
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className={summaryCardClass}>
              <p className={labelTextClass}>Всего</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{requests.length}</p>
            </div>
            <div className={pendingSummaryCardClass}>
              <p className="text-xs text-warning-foreground">На согласовании</p>
              <p className="mt-1 text-xl font-semibold text-warning">{pendingCount}</p>
            </div>
            <div className={approvedSummaryCardClass}>
              <p className="text-xs text-success-foreground">Согласовано</p>
              <p className="mt-1 text-xl font-semibold text-success">{approvedCount}</p>
            </div>
            <div className={rejectedSummaryCardClass}>
              <p className="text-xs text-danger-foreground">Отклонено</p>
              <p className="mt-1 text-xl font-semibold text-danger">{rejectedCount}</p>
            </div>
          </div>

          {error && (
            <div className={errorPanelClass}>
              {error instanceof Error ? error.message : 'Не удалось загрузить согласования.'}
            </div>
          )}

          {actionError && (
            <div className={errorPanelClass}>
              {actionError}
            </div>
          )}

          {isLoading ? (
            <div className="rounded-lg border border-border bg-muted/25 p-8 text-center text-sm text-muted-foreground">
              Загружаем историю согласований...
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-8 text-center text-sm text-muted-foreground">
              Согласований по редактированию аренды пока нет.
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map(request => (
                <div
                  key={request.id}
                  className={requestCardClass}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {statusIcon(request.status)}
                        <p className="font-semibold text-foreground">{request.typeLabel || request.type || 'Изменение аренды'}</p>
                        {statusBadge(request.status)}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(request.createdAt)} · {request.initiatorName || 'Система'} · {request.initiatorRole || 'роль не указана'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" asChild>
                        <Link to={`/rentals/${request.rentalId}`}>
                          Открыть аренду
                        </Link>
                      </Button>
                      {request.status === 'pending' && isAdmin && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void handleApprove(request)}
                            disabled={approveMutation.isPending || rejectMutation.isPending || !rentalByRequestId.get(request.id)}
                          >
                            <Check className="h-4 w-4" />
                            Согласовать
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => startReject(request)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            <X className="h-4 w-4" />
                            Отклонить
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div>
                      <p className={labelTextClass}>Аренда</p>
                      <p className={valueTextClass}>{request.rentalId || '—'}</p>
                    </div>
                    <div>
                      <p className={labelTextClass}>Клиент</p>
                      <p className={valueTextClass}>{resolveClientDisplay(rentalByRequestId.get(request.id) || null, request, clients)}</p>
                    </div>
                    <div>
                      <p className={labelTextClass}>Техника</p>
                      {renderEquipmentList(request)}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {getRequestChanges(request).map(change => (
                      <div
                        key={`${request.id}-${change.field}`}
                        className={changePanelClass}
                      >
                        <p className="text-xs font-medium text-muted-foreground">{change.label}</p>
                        <div className="mt-2 grid gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <p className="break-words text-muted-foreground">{displayValue(change.oldValue)}</p>
                          <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" />
                          <p className="break-words font-medium text-foreground">{displayValue(change.newValue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div>
                      <p className={labelTextClass}>Причина</p>
                      <p className="text-sm text-foreground">{request.reason || request.systemReason || '—'}</p>
                    </div>
                    <div>
                      <p className={labelTextClass}>Комментарий</p>
                      <p className="text-sm text-foreground">{request.comment || request.adminComment || '—'}</p>
                    </div>
                    <div>
                      <p className={labelTextClass}>Финансовое влияние</p>
                      <p className="text-sm font-medium text-foreground">{financialImpact(request)}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
                    {getRequestDecisionText(request)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>

      <Dialog open={!!rejecting} onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setRejecting(null);
          setRejectReason('');
        }
      }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Причина отклонения</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            className="min-h-28"
            placeholder="Укажите, почему изменение нельзя применить"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Отмена</Button>
            <Button
              onClick={() => void handleReject()}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Отклонение...' : 'Отклонить заявку'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
