import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { financeService } from '../../services/finance.service';
import type {
  CanonicalActualPostingPreviewItem,
  CanonicalActualPostingResult,
} from '../../types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export const CANONICAL_ACTUAL_POSTING_QUERY_KEY = ['finance', 'canonical-actual-posting-events'] as const;

type ProductErrorBody = {
  status?: string;
  error?: string;
  requestId?: string;
};

type PostingNotice = {
  kind: 'created' | 'already_created' | 'error';
  message: string;
  requestId?: string;
  result?: CanonicalActualPostingResult;
};

function formatMinorAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency || 'RUB',
    maximumFractionDigits: 2,
  }).format(Number(amount || 0) / 100);
}

function basisLabel(value: string) {
  if (value === 'gross' || value === 'slice_gross_minor') return 'Проведённый УПД: сумма с НДС';
  return value || 'Подготовленный canonical event';
}

function errorNotice(error: unknown): PostingNotice {
  const body = error instanceof ApiError && error.body && typeof error.body === 'object'
    ? error.body as ProductErrorBody
    : {};
  return {
    kind: 'error',
    message: typeof body.error === 'string'
      ? body.error
      : error instanceof Error
        ? error.message
        : 'Не удалось создать фактическое начисление.',
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
  };
}

function readinessBadge(item: CanonicalActualPostingPreviewItem) {
  if (item.readiness === 'already_created') return <Badge variant="success">Уже создано</Badge>;
  if (item.readiness === 'ready') return <Badge variant="info">Готово</Badge>;
  return <Badge variant="warning">Недоступно</Badge>;
}

export function CanonicalActualPostingPanel({ canManageFinance }: { canManageFinance: boolean }) {
  const queryClient = useQueryClient();
  const postingLockRef = React.useRef(false);
  const [confirmation, setConfirmation] = React.useState<CanonicalActualPostingPreviewItem | null>(null);
  const [notice, setNotice] = React.useState<PostingNotice | null>(null);

  const events = useQuery({
    queryKey: CANONICAL_ACTUAL_POSTING_QUERY_KEY,
    queryFn: financeService.getCanonicalActualPostingEvents,
    enabled: canManageFinance,
    staleTime: 30_000,
  });
  const posting = useMutation({
    mutationFn: (eventId: string) => financeService.postCanonicalActualPostingEvent(eventId),
  });

  const confirmPosting = async () => {
    if (!confirmation || postingLockRef.current || posting.isPending) return;
    postingLockRef.current = true;
    setNotice(null);
    try {
      const result = await posting.mutateAsync(confirmation.eventId);
      const alreadyCreated = result.status === 'already_created';
      const nextNotice: PostingNotice = {
        kind: alreadyCreated ? 'already_created' : 'created',
        message: alreadyCreated
          ? 'Начисление уже было создано ранее.'
          : 'Фактическое начисление создано.',
        requestId: result.requestId,
        result,
      };
      setNotice(nextNotice);
      setConfirmation(null);
      toast.success(nextNotice.message);
      await queryClient.invalidateQueries({ queryKey: CANONICAL_ACTUAL_POSTING_QUERY_KEY });
    } catch (error) {
      const nextNotice = errorNotice(error);
      setNotice(nextNotice);
      toast.error(nextNotice.message);
    } finally {
      postingLockRef.current = false;
    }
  };

  if (!canManageFinance) return null;

  const runtime = events.data?.runtime;
  const items = events.data?.items || [];

  return (
    <Card data-canonical-actual-posting-panel>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-5 w-5" />
              Подготовленные фактические начисления
            </CardTitle>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Только ручное создание из проверенного canonical event. Исходные данные на этом экране не изменяются.
            </p>
          </div>
          {!runtime?.enabled && runtime?.message ? <Badge variant="warning">Функция выключена</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!runtime?.enabled && runtime?.message ? (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{runtime.message}</span>
          </div>
        ) : null}

        {notice ? (
          <div className={`rounded-lg border p-3 text-sm ${notice.kind === 'error'
            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'}`}>
            <div className="flex items-start gap-2">
              {notice.kind === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
              <div>
                <p className="font-medium">{notice.message}</p>
                {notice.result ? (
                  <p className="mt-1">
                    Начисление: {notice.result.receivableId}; операция: {notice.result.operationId}; сумма: {formatMinorAmount(notice.result.amount, notice.result.currency)}.
                  </p>
                ) : null}
                {notice.requestId ? <p className="mt-1 text-xs">Request ID: {notice.requestId}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {events.isLoading ? <p className="text-sm text-gray-500">Загружаем подготовленные операции...</p> : null}
        {events.isError ? <p className="text-sm text-red-600">Не удалось получить подготовленные операции.</p> : null}
        {!events.isLoading && !events.isError && runtime?.enabled && items.length === 0 ? (
          <p className="text-sm text-gray-500">Подходящих операций пока нет.</p>
        ) : null}

        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Основание</TableHead>
                  <TableHead>Готовность</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.eventId}>
                    <TableCell>
                      <p className="font-medium">{item.client}</p>
                      <p className="text-xs text-gray-500">{item.clientId}</p>
                    </TableCell>
                    <TableCell>
                      <p>{item.contractId ? `Договор ${item.contractId}` : `Документ ${item.sourceDocumentId}`}</p>
                      <p className="text-xs text-gray-500">Аренда {item.rentalId}</p>
                    </TableCell>
                    <TableCell>{item.branch}</TableCell>
                    <TableCell>{formatDate(item.periodStartDate)} — {formatDate(item.periodEndDateExclusive)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMinorAmount(item.amount, item.currency)}</TableCell>
                    <TableCell>{basisLabel(item.basis)}</TableCell>
                    <TableCell>
                      {readinessBadge(item)}
                      {item.disabledReason ? <p className="mt-1 max-w-48 text-xs text-gray-500">{item.disabledReason}</p> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={!item.canPost || posting.isPending}
                        onClick={() => item.canPost && setConfirmation(item)}
                      >
                        Создать фактическое начисление
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => !open && !posting.isPending && setConfirmation(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Создать фактическое начисление?</DialogTitle>
            <DialogDescription>
              Будет создано фактическое начисление на сумму {confirmation ? formatMinorAmount(confirmation.amount, confirmation.currency) : '—'} для клиента {confirmation?.client || '—'}.
              После проведения операция остаётся идемпотентной, но изменять исходные данные через этот экран нельзя.
            </DialogDescription>
          </DialogHeader>
          {confirmation ? (
            <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
              <p>Договор/источник: {confirmation.contractId || confirmation.sourceDocumentId}</p>
              <p>Филиал: {confirmation.branch}</p>
              <p>Период: {formatDate(confirmation.periodStartDate)} — {formatDate(confirmation.periodEndDateExclusive)}</p>
              <p>Основание: {basisLabel(confirmation.basis)}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={posting.isPending} onClick={() => setConfirmation(null)}>Отмена</Button>
            <Button type="button" disabled={posting.isPending} onClick={confirmPosting}>
              {posting.isPending ? 'Создаём начисление...' : 'Создать начисление'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
