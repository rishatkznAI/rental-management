import React from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { getDocumentStatusBadge } from '../components/ui/Badge';
import { Search, Download, Eye } from 'lucide-react';
import { loadDocuments, DOCUMENTS_STORAGE_KEY } from '../mock-data';
import { formatDate, formatCurrency } from '../lib/utils';
import type { DocumentType, Document as Doc } from '../types';

export default function Documents() {
  const [documentList, setDocumentList] = React.useState<Doc[]>(() => loadDocuments());
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === DOCUMENTS_STORAGE_KEY) setDocumentList(loadDocuments()); };
    const onFocus = () => setDocumentList(loadDocuments());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
  }, []);

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

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Документы</h1>
          <p className="mt-1 text-sm text-gray-500">Договоры, акты и счета</p>
        </div>
        <Button>
          <Download className="h-4 w-4" />
          Экспорт списка
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Поиск по номеру, клиенту..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Select
          value={typeFilter}
          onValueChange={setTypeFilter}
          placeholder="Все типы"
          options={[
            { value: 'all', label: 'Все типы' },
            { value: 'contract', label: 'Договоры' },
            { value: 'act', label: 'Акты' },
            { value: 'invoice', label: 'Счета' },
          ]}
          className="w-[160px]"
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="Все статусы"
          options={[
            { value: 'all', label: 'Все статусы' },
            { value: 'draft', label: 'Черновик' },
            { value: 'signed', label: 'Подписан' },
            { value: 'sent', label: 'Отправлен' },
          ]}
          className="w-[160px]"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
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
                  <p className="font-medium text-gray-900">{doc.number}</p>
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
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {getDocumentStatusBadge(doc.status)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <button className="rounded p-1 hover:bg-gray-100" title="Просмотр">
                      <Eye className="h-4 w-4 text-gray-500" />
                    </button>
                    <button className="rounded p-1 hover:bg-gray-100" title="Скачать">
                      <Download className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredDocuments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Документы не найдены</h3>
            <p className="mt-1 text-sm text-gray-500">
              Попробуйте изменить параметры поиска или фильтры
            </p>
          </div>
        )}
      </div>

      {/* Results info */}
      {filteredDocuments.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <p>Показано {filteredDocuments.length} из {documentList.length} документов</p>
        </div>
      )}
    </div>
  );
}
