import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Download, Eye, Search, Upload, UserRound } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useDocumentsList } from '../hooks/useDocuments';
import { downloadPrintableHtml, openPrintableHtml } from '../lib/serviceWorkOrder';
import { formatDate, formatCurrency } from '../lib/utils';
import { mechanicsService } from '../services/mechanics.service';
import { mechanicDocumentsService } from '../services/mechanic-documents.service';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import type { DocumentType, Document as Doc, Mechanic, MechanicDocument } from '../types';

type DocumentsView = 'general' | 'mechanics';

function downloadMechanicDocument(doc: MechanicDocument) {
  const link = document.createElement('a');
  link.href = doc.dataUrl;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
  if (size >= 1024) return `${Math.round(size / 1024)} КБ`;
  return `${size} Б`;
}

export default function Documents() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canManageDocuments = can('create', 'documents') || can('edit', 'documents');
  const { data: documentList = [] } = useDocumentsList();
  const { data: mechanics = [] } = useQuery<Mechanic[]>({
    queryKey: ['mechanics'],
    queryFn: mechanicsService.getAll,
  });
  const { data: mechanicDocsData = [] } = useQuery<MechanicDocument[]>({
    queryKey: ['mechanic-documents'],
    queryFn: mechanicDocumentsService.getAll,
  });

  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [view, setView] = React.useState<DocumentsView>('general');
  const [mechanicSearch, setMechanicSearch] = React.useState('');
  const [selectedMechanicId, setSelectedMechanicId] = React.useState<string>('');
  const [mechanicDocuments, setMechanicDocuments] = React.useState<MechanicDocument[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setMechanicDocuments(mechanicDocsData);
  }, [mechanicDocsData]);

  React.useEffect(() => {
    if (!selectedMechanicId && mechanics.length > 0) {
      setSelectedMechanicId(mechanics[0].id);
    }
  }, [mechanics, selectedMechanicId]);

  const filteredDocuments = documentList.filter(doc => {
    const matchesSearch = search === ''
      || doc.number.toLowerCase().includes(search.toLowerCase())
      || doc.client.toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const getDocumentTypeLabel = (type: DocumentType): string => {
    const labels: Record<DocumentType, string> = {
      contract: 'Договор',
      act: 'Акт',
      invoice: 'Счёт',
      work_order: 'Заказ-наряд',
    };
    return labels[type];
  };

  const openDocument = (doc: Doc) => {
    if (!doc.contentHtml) return;
    openPrintableHtml(doc.contentHtml);
  };

  const downloadDocument = (doc: Doc) => {
    if (!doc.contentHtml) return;
    downloadPrintableHtml(doc.contentHtml, `${doc.number}.html`);
  };

  const activeFilterCount = [
    search.trim() !== '',
    typeFilter !== 'all',
    statusFilter !== 'all',
  ].filter(Boolean).length;

  const filteredMechanics = React.useMemo(() => (
    mechanics
      .filter(item => item.status === 'active')
      .filter(item => {
        const query = mechanicSearch.trim().toLowerCase();
        if (!query) return true;
        return item.name.toLowerCase().includes(query) || (item.phone || '').toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  ), [mechanicSearch, mechanics]);

  const selectedMechanic = filteredMechanics.find(item => item.id === selectedMechanicId)
    || mechanics.find(item => item.id === selectedMechanicId)
    || null;

  const selectedMechanicDocuments = React.useMemo(
    () => mechanicDocuments
      .filter(item => item.mechanicId === selectedMechanicId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [mechanicDocuments, selectedMechanicId],
  );

  const persistMechanicDocuments = React.useCallback(async (next: MechanicDocument[]) => {
    setMechanicDocuments(next);
    await mechanicDocumentsService.bulkReplace(next);
    await queryClient.invalidateQueries({ queryKey: ['mechanic-documents'] });
  }, [queryClient]);

  const handleMechanicUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!selectedMechanic || files.length === 0) return;

    const uploadedBy = user?.name || 'Система';
    const prepared = await Promise.all(files.map(file => (
      new Promise<MechanicDocument>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: `mech-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mechanicId: selectedMechanic.id,
          mechanicName: selectedMechanic.name,
          title: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
          dataUrl: String(reader.result || ''),
        });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })
    )));

    await persistMechanicDocuments([...mechanicDocuments, ...prepared]);
    event.target.value = '';
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Документы</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Договоры, акты, счета, заказ-наряды и данные по механикам.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={view === 'general' ? 'default' : 'secondary'}
            onClick={() => setView('general')}
          >
            Документы
          </Button>
          <Button
            variant={view === 'mechanics' ? 'default' : 'secondary'}
            onClick={() => setView('mechanics')}
          >
            <UserRound className="h-4 w-4" />
            Механики
          </Button>
        </div>
      </div>

      {view === 'general' ? (
        <>
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
                    <SelectItem value="work_order">Заказ-наряды</SelectItem>
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

          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
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
                    <TableCell>{getDocumentStatusBadge(doc.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openDocument(doc)}
                          disabled={!doc.contentHtml}
                          className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={doc.contentHtml ? 'Просмотр' : 'Просмотр недоступен'}
                        >
                          <Eye className={`h-4 w-4 ${doc.contentHtml ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`} />
                        </button>
                        <button
                          onClick={() => downloadDocument(doc)}
                          disabled={!doc.contentHtml}
                          className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={doc.contentHtml ? 'Скачать' : 'Скачать недоступно'}
                        >
                          <Download className={`h-4 w-4 ${doc.contentHtml ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`} />
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

          {filteredDocuments.length > 0 && (
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <p>Показано {filteredDocuments.length} из {documentList.length} документов</p>
            </div>
          )}
        </>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleMechanicUpload}
          />

          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Механики</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Выберите механика, чтобы открыть его документы.
                </p>
              </div>

              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по ФИО или телефону..."
                  value={mechanicSearch}
                  onChange={(e) => setMechanicSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="space-y-2">
                {filteredMechanics.map(mechanic => {
                  const docsCount = mechanicDocuments.filter(item => item.mechanicId === mechanic.id).length;
                  const isActive = selectedMechanicId === mechanic.id;
                  return (
                    <div
                      key={mechanic.id}
                      className={`rounded-xl border p-3 transition-colors ${
                        isActive
                          ? 'border-[--color-primary] bg-[--color-primary]/8'
                          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedMechanicId(mechanic.id)}
                        className="w-full text-left"
                      >
                        <p className="font-medium text-gray-900 dark:text-white">{mechanic.name}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {mechanic.phone || 'Телефон не указан'} · {docsCount} файл(ов)
                        </p>
                      </button>
                    </div>
                  );
                })}

                {filteredMechanics.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Механики по запросу не найдены.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              {selectedMechanic ? (
                <>
                  <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{selectedMechanic.name}</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Документы механика. Позже этот реестр можно использовать из других разделов по ФИО.
                      </p>
                    </div>
                    {canManageDocuments && (
                      <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4" />
                        Загрузить данные
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {selectedMechanicDocuments.length > 0 ? (
                      selectedMechanicDocuments.map(doc => (
                        <div
                          key={doc.id}
                          className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{doc.title}</p>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                              {doc.fileName} · {formatFileSize(doc.size)}
                            </p>
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                              Загружено {formatDate(doc.uploadedAt)}{doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
                            </p>
                          </div>
                          <Button variant="secondary" onClick={() => downloadMechanicDocument(doc)}>
                            <Download className="h-4 w-4" />
                            Скачать
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Для этого механика документы пока не загружены.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Выберите механика слева, чтобы открыть его документы.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
