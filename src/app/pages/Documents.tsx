import React from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getDocumentStatusBadge } from '../components/ui/badge';
import { Search, Download, Eye } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useDocumentsList } from '../hooks/useDocuments';
import { formatDate, formatCurrency } from '../lib/utils';
import type { DocumentType, Document as Doc } from '../types';

export default function Documents() {
  const { data: documentList = [] } = useDocumentsList();
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [showFilters, setShowFilters] = React.useState(false);

  const filteredDocuments = documentList.filter(doc => {
    const matchesSearch = search === '' ||
      doc.number.toLowerCase().includes(search.toLowerCase()) ||
      doc.client.toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const getDocumentTypeLabel = (type: DocumentType): string => {
    const labels: Record<DocumentType, string> = {
      contract: 'Договор',
      act: 'Акт',
      invoice: 'Счёт',
    };
    return labels[type];
  };

  const activeFilterCount = [
    search.trim() !== '',
    typeFilter !== 'all',
    statusFilter !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Документы</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Договоры, акты и счета</p>
        </div>
        <Button>
          <Download className="h-4 w-4" />
          Экспорт списка
        </Button>
      </div>

      <div className="flex justify-end">
        <FilterButton activeCount={activeFilterCount} onClick={() => setShowFilters(true)} />
      </div>

      <FilterDialog
        open={showFilters}
        onOpenChange={setShowFilters}
        title="Фильтры документов"
        description="Отбери документы по поиску, типу и статусу."
        onReset={() => {
          setSearch('');
          setTypeFilter('all');
          setStatusFilter('all');
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Поиск" className="md:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по номеру, клиенту..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="app-filter-input pl-10"
              />
            </div>
          </FilterField>
          <FilterField label="Тип документа">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="app-filter-input">
                <SelectValue placeholder="Все типы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                <SelectItem value="contract">Договоры</SelectItem>
                <SelectItem value="act">Акты</SelectItem>
                <SelectItem value="invoice">Счета</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Статус">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="app-filter-input">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="draft">Черновик</SelectItem>
                <SelectItem value="signed">Подписан</SelectItem>
                <SelectItem value="sent">Отправлен</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </FilterDialog>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тип</TableHead>
              <TableHead>Номер</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Сумма</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[100px]">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDocuments.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <p className="text-sm font-medium">{getDocumentTypeLabel(doc.type)}</p>
                </TableCell>
                <TableCell>
                  <p className="font-medium text-gray-900 dark:text-white">{doc.number}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{doc.client}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm">{formatDate(doc.date)}</p>
                </TableCell>
                <TableCell>
                  {doc.amount ? (
                    <p className="text-sm font-medium">{formatCurrency(doc.amount)}</p>
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {getDocumentStatusBadge(doc.status)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <button
                      className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      title="Просмотр"
                    >
                      <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    </button>
                    <button
                      className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      title="Скачать"
                    >
                      <Download className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredDocuments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
              <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Документы не найдены</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredDocuments.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <p>Показано {filteredDocuments.length} из {documentList.length} документов</p>
        </div>
      )}
    </div>
  );
}
