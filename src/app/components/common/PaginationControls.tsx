import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import type { PaginationMeta } from '../../lib/api';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type PaginationControlsProps = {
  pagination?: PaginationMeta;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
};

function rangeLabel(pagination?: PaginationMeta) {
  if (!pagination || pagination.total === 0) return '0 из 0';
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.total, pagination.page * pagination.pageSize);
  return `${from}-${to} из ${pagination.total}`;
}

export function PaginationControls({
  pagination,
  loading = false,
  onPageChange,
  onPageSizeChange,
  className = '',
}: PaginationControlsProps) {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 25;
  const hasPrevPage = Boolean(pagination?.hasPrevPage);
  const hasNextPage = Boolean(pagination?.hasNextPage);

  return (
    <div className={`flex flex-col gap-3 border-t border-gray-100 px-3 py-3 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:text-gray-400 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[--color-primary]" />}
        <span className="font-medium text-gray-700 dark:text-gray-200">{rangeLabel(pagination)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium">На странице</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
          >
            {PAGE_SIZE_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!hasPrevPage || loading}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!hasNextPage || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Вперёд
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
