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
import { useEquipmentList } from '../../hooks/useEquipment';
import {
  useApproveRentalChangeRequest,
  useRejectRentalChangeRequest,
} from '../../hooks/useRentalChangeRequests';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import type { Equipment, RentalChangeRequest, RentalChangeRequestStatus } from '../../types';

const statusLabels: Record<RentalChangeRequestStatus, string> = {
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
};

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
  if (status === 'approved') return <Check className="h-4 w-4 text-emerald-500" />;
  if (status === 'rejected') return <X className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
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

function resolveEquipmentDisplayItems(request: RentalChangeRequest, equipmentList: Equipment[]) {
  const refs = [
    ...(Array.isArray(request.equipment) ? request.equipment : []),
    ...asStringList(request.oldValues?.equipment),
    ...asStringList(request.newValues?.equipment),
  ].map(item => String(item || '').trim()).filter(Boolean);
  const uniqueRefs = [...new Set(refs)];

  if (uniqueRefs.length === 0) return ['—'];

  return uniqueRefs.map((ref) => {
    const matched = equipmentList.find(item => equipmentMatchesRef(item, ref));
    return matched ? buildEquipmentTitle(matched, ref) : ref;
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
  const { data: equipmentList = [] } = useEquipmentList();
  const approveMutation = useApproveRentalChangeRequest();
  const rejectMutation = useRejectRentalChangeRequest();
  const [rejecting, setRejecting] = React.useState<RentalChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const pendingCount = requests.filter(item => item.status === 'pending').length;
  const approvedCount = requests.filter(item => item.status === 'approved').length;
  const rejectedCount = requests.filter(item => item.status === 'rejected').length;
  const isAdmin = String(user?.role || '').trim() === 'Администратор';
  const equipmentDisplayByRequestId = React.useMemo(() => (
    new Map(requests.map(request => [
      request.id,
      resolveEquipmentDisplayItems(request, equipmentList),
    ]))
  ), [equipmentList, requests]);

  const renderEquipmentList = (request: RentalChangeRequest) => {
    const items = equipmentDisplayByRequestId.get(request.id) || ['—'];
    return (
      <div className="space-y-1">
        {items.map((item, index) => (
          <p key={`${request.id}:equipment:${index}`} className="font-medium text-gray-900 dark:text-white">
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
      <SheetContent side="right" className="w-full overflow-y-auto border-gray-200 bg-white sm:max-w-3xl dark:border-gray-700 dark:bg-gray-950">
        <SheetHeader className="border-b border-gray-200 pb-4 dark:border-gray-700">
          <SheetTitle className="flex items-center gap-2 text-xl text-gray-900 dark:text-white">
            <FileText className="h-5 w-5 text-[--color-primary]" />
            Согласования аренды
          </SheetTitle>
          <SheetDescription>
            История заявок на защищённые изменения карточек аренды
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-xs text-gray-500 dark:text-gray-400">Всего</p>
              <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">{requests.length}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="text-xs text-amber-700 dark:text-amber-300">На согласовании</p>
              <p className="mt-1 text-xl font-semibold text-amber-800 dark:text-amber-200">{pendingCount}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">Согласовано</p>
              <p className="mt-1 text-xl font-semibold text-emerald-800 dark:text-emerald-200">{approvedCount}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
              <p className="text-xs text-red-700 dark:text-red-300">Отклонено</p>
              <p className="mt-1 text-xl font-semibold text-red-800 dark:text-red-200">{rejectedCount}</p>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error instanceof Error ? error.message : 'Не удалось загрузить согласования.'}
            </div>
          )}

          {actionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {actionError}
            </div>
          )}

          {isLoading ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
              Загружаем историю согласований...
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Согласований по редактированию аренды пока нет.
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map(request => (
                <div
                  key={request.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {statusIcon(request.status)}
                        <p className="font-semibold text-gray-900 dark:text-white">{request.type || 'Изменение аренды'}</p>
                        {statusBadge(request.status)}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
                            disabled={approveMutation.isPending || rejectMutation.isPending}
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
                      <p className="text-xs text-gray-500 dark:text-gray-400">Аренда</p>
                      <p className="font-medium text-gray-900 dark:text-white">{request.rentalId || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Клиент</p>
                      <p className="font-medium text-gray-900 dark:text-white">{request.client || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Техника</p>
                      {renderEquipmentList(request)}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {getRequestChanges(request).map(change => (
                      <div
                        key={`${request.id}-${change.field}`}
                        className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950/60"
                      >
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{change.label}</p>
                        <div className="mt-2 grid gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <p className="break-words text-gray-700 dark:text-gray-300">{displayValue(change.oldValue)}</p>
                          <ArrowRight className="hidden h-4 w-4 text-gray-400 md:block" />
                          <p className="break-words font-medium text-gray-900 dark:text-white">{displayValue(change.newValue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Причина</p>
                      <p className="text-sm text-gray-900 dark:text-white">{request.reason || request.systemReason || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Комментарий</p>
                      <p className="text-sm text-gray-900 dark:text-white">{request.comment || request.adminComment || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Финансовое влияние</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{financialImpact(request)}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-300">
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
