import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, FileText, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
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

export default function Approvals() {
  const { user } = useAuth();
  const { data: requests = [], isLoading, error } = useRentalChangeRequestsList();
  const approveMutation = useApproveRentalChangeRequest();
  const rejectMutation = useRejectRentalChangeRequest();
  const [rejecting, setRejecting] = React.useState<RentalChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [actionError, setActionError] = React.useState('');

  const pending = requests.filter(item => item.status === 'pending');
  const processed = requests
    .filter(item => item.status !== 'pending')
    .sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt)));
  const ordered = [...pending, ...processed];
  const isAdmin = user?.role === 'Администратор';

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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не удалось согласовать заявку.');
    }
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
                          onClick={() => {
                            setRejecting(request);
                            setRejectReason('');
                          }}
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
