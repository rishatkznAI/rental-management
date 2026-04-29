import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, Eye, FileText, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import {
  useApproveRentalChangeRequest,
  useRejectRentalChangeRequest,
  useRentalChangeRequestsList,
} from '../hooks/useRentalChangeRequests';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDateTime } from '../lib/utils';
import type { RentalChangeRequest, RentalChangeRequestStatus } from '../types';

const statusLabels: Record<RentalChangeRequestStatus, string> = {
  pending: 'На согласовании',
  approved: 'Согласовано / Применено',
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

function financialImpact(request: RentalChangeRequest) {
  const amount = request.financialImpact?.amount ?? 0;
  if (amount === 0) return request.financialImpact?.description || 'Без прямого изменения суммы';
  return `${amount > 0 ? '+' : ''}${formatCurrency(amount)}`;
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-gray-900 dark:text-white">
        {children || '—'}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { user } = useAuth();
  const { data: requests = [], isLoading, error } = useRentalChangeRequestsList();
  const approveMutation = useApproveRentalChangeRequest();
  const rejectMutation = useRejectRentalChangeRequest();
  const [selected, setSelected] = React.useState<RentalChangeRequest | null>(null);
  const [rejecting, setRejecting] = React.useState<RentalChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [actionError, setActionError] = React.useState('');

  const pending = requests.filter(item => item.status === 'pending');
  const processed = requests
    .filter(item => item.status !== 'pending')
    .sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt)));
  const ordered = [...pending, ...processed];
  const userRole = String(user?.role || '').trim();
  const isAdmin = userRole === 'Администратор';

  const handleReject = async () => {
    if (!rejecting) return;
    setActionError('');
    try {
      await rejectMutation.mutateAsync({ id: rejecting.id, reason: rejectReason });
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не удалось отклонить заявку.');
    }
  };

  const handleApprove = async (request: RentalChangeRequest) => {
    setActionError('');
    try {
      await approveMutation.mutateAsync({ id: request.id });
      if (selected?.id === request.id) {
        setSelected(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не удалось согласовать заявку.');
    }
  };

  const startReject = (request: RentalChangeRequest) => {
    setRejecting(request);
    setRejectReason('');
    setSelected(null);
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Согласования</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Заявки на защищённые изменения аренды, документов и платежей
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Badge variant="warning">{pending.length} на согласовании</Badge>
          <Badge variant="default">{processed.length} обработано</Badge>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error instanceof Error ? error.message : 'Не удалось загрузить заявки.'}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            Загружаем заявки...
          </CardContent>
        </Card>
      ) : ordered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            Нет заявок на согласование.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ordered.map(request => (
            <Card key={request.id}>
              <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {request.status === 'pending' ? <Clock className="h-5 w-5 text-amber-500" /> : <FileText className="h-5 w-5 text-[--color-primary]" />}
                      {request.type}
                    </CardTitle>
                    <CardDescription>
                      {formatDateTime(request.createdAt)} · {request.initiatorName} · {request.initiatorRole || 'роль не указана'}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(request.status)}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(request)}
                    >
                      <Eye className="h-4 w-4" />
                      Открыть
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
                    {request.status === 'pending' && !isAdmin && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">Ожидает администратора</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Аренда</p>
                    <Link to={`/rentals/${request.rentalId}`} className="font-medium text-[--color-primary] hover:underline">
                      {request.rentalId || '—'}
                    </Link>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Клиент</p>
                    <p className="font-medium text-gray-900 dark:text-white">{request.client || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Техника</p>
                    <p className="font-medium text-gray-900 dark:text-white">{request.equipment?.join(', ') || '—'}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Поле</p>
                    <p className="font-medium text-gray-900 dark:text-white">{request.fieldLabel || request.field}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Старое значение</p>
                    <p className="break-words text-sm text-gray-900 dark:text-white">{displayValue(request.oldValue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Новое значение</p>
                    <p className="break-words text-sm text-gray-900 dark:text-white">{displayValue(request.newValue)}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Причина изменения</p>
                    <p className="text-sm text-gray-900 dark:text-white">{request.reason || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Комментарий</p>
                    <p className="text-sm text-gray-900 dark:text-white">{request.comment || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Финансовое влияние</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{financialImpact(request)}</p>
                  </div>
                </div>

                {request.attachments && request.attachments.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Вложения</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {request.attachments.map((attachment, index) => (
                        <Badge key={`${attachment}-${index}`} variant="default">{attachment}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {request.status !== 'pending' && (
                  <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
                    <p className="text-gray-700 dark:text-gray-300">
                      {request.status === 'approved'
                        ? `Согласовал: ${request.decidedByName || '—'}${request.appliedAt ? ` · применено ${formatDateTime(request.appliedAt)}` : ''}`
                        : `Отклонил: ${request.decidedByName || '—'} · причина: ${request.rejectionReason || '—'}`}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}>
        {selected && (
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selected.status === 'pending' ? <Clock className="h-5 w-5 text-amber-500" /> : <FileText className="h-5 w-5 text-[--color-primary]" />}
                {selected.type}
              </DialogTitle>
              <DialogDescription>
                {formatDateTime(selected.createdAt)} · {selected.initiatorName} · {selected.initiatorRole || 'роль не указана'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(selected.status)}
                {selected.status === 'pending' && !isAdmin && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Согласовать или отклонить может только администратор. Текущая роль: {userRole || 'не определена'}.
                  </span>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <DetailField label="Аренда">
                  {selected.rentalId ? (
                    <Link to={`/rentals/${selected.rentalId}`} className="text-[--color-primary] hover:underline">
                      {selected.rentalId}
                    </Link>
                  ) : '—'}
                </DetailField>
                <DetailField label="Клиент">{selected.client || '—'}</DetailField>
                <DetailField label="Техника">{selected.equipment?.join(', ') || '—'}</DetailField>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <DetailField label="Поле">{selected.fieldLabel || selected.field}</DetailField>
                <DetailField label="Старое значение">{displayValue(selected.oldValue)}</DetailField>
                <DetailField label="Новое значение">{displayValue(selected.newValue)}</DetailField>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <DetailField label="Причина изменения">{selected.reason || '—'}</DetailField>
                <DetailField label="Комментарий">{selected.comment || '—'}</DetailField>
                <DetailField label="Финансовое влияние">{financialImpact(selected)}</DetailField>
              </div>

              {selected.changes && selected.changes.length > 1 && (
                <div>
                  <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Все изменения</p>
                  <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                    {selected.changes.map((change, index) => (
                      <div
                        key={`${change.field}-${index}`}
                        className="grid gap-2 border-b border-gray-200 p-3 text-sm last:border-b-0 dark:border-gray-800 md:grid-cols-3"
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{change.field}</span>
                        <span className="break-words text-gray-600 dark:text-gray-300">{displayValue(change.oldValue)}</span>
                        <span className="break-words text-gray-900 dark:text-white">{displayValue(change.newValue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Вложения</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {selected.attachments.map((attachment, index) => (
                      <Badge key={`${attachment}-${index}`} variant="default">{attachment}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selected.status !== 'pending' && (
                <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
                  <p className="text-gray-700 dark:text-gray-300">
                    {selected.status === 'approved'
                      ? `Согласовал: ${selected.decidedByName || '—'}${selected.appliedAt ? ` · применено ${formatDateTime(selected.appliedAt)}` : ''}`
                      : `Отклонил: ${selected.decidedByName || '—'} · причина: ${selected.rejectionReason || '—'}`}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setSelected(null)}>Закрыть</Button>
              {selected.status === 'pending' && isAdmin && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => startReject(selected)}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                    Отклонить
                  </Button>
                  <Button
                    onClick={() => void handleApprove(selected)}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                  >
                    <Check className="h-4 w-4" />
                    {approveMutation.isPending ? 'Согласование...' : 'Согласовать'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(open) => {
        if (!open) {
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
    </div>
  );
}
