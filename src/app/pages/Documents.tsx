import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';
import { getDocumentStatusBadge } from '../components/ui/badge';
import { ClientCombobox } from '../components/ui/ClientCombobox';
import {
  CheckCircle2,
  Download,
  Eye,
  FileSignature,
  Plus,
  Search,
  Upload,
  UserRound,
} from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useClientsList } from '../hooks/useClients';
import { useCreateDocument, useDocumentsList, useUpdateDocument } from '../hooks/useDocuments';
import { downloadPrintableHtml, openPrintableHtml } from '../lib/serviceWorkOrder';
import { formatDate, formatCurrency, formatDateTime } from '../lib/utils';
import { mechanicsService } from '../services/mechanics.service';
import { mechanicDocumentsService } from '../services/mechanic-documents.service';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import type {
  Client,
  Document as Doc,
  DocumentContractKind,
  DocumentStatus,
  DocumentType,
  Mechanic,
  MechanicDocument,
} from '../types';

type DocumentsView = 'general' | 'mechanics';

const VALID_DOCUMENT_TYPES = new Set<DocumentType>(['contract', 'act', 'invoice', 'work_order']);
const VALID_DOCUMENT_STATUSES = new Set<DocumentStatus>(['draft', 'signed', 'sent']);

type ContractFormState = {
  clientId: string;
  client: string;
  signatoryName: string;
  signatoryBasis: string;
  date: string;
  comment: string;
};

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function openDataUrl(dataUrl: string) {
  window.open(dataUrl, '_blank', 'noopener,noreferrer');
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadMechanicDocument(doc: MechanicDocument) {
  downloadDataUrl(doc.dataUrl, doc.fileName);
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
  if (size >= 1024) return `${Math.round(size / 1024)} КБ`;
  return `${size} Б`;
}

function getContractKindLabel(kind?: DocumentContractKind) {
  if (kind === 'supply') return 'Договор поставки';
  return 'Договор аренды';
}

function displayText(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function searchText(value: unknown) {
  return String(value ?? '').toLowerCase();
}

export function getDocumentTypeLabel(doc: Partial<Doc> | null | undefined): string {
  const labels: Record<DocumentType, string> = {
    contract: getContractKindLabel(doc?.contractKind),
    act: 'Акт',
    invoice: 'Счёт',
    work_order: 'Заказ-наряд',
  };
  const type = doc?.type;
  return VALID_DOCUMENT_TYPES.has(type as DocumentType) ? labels[type as DocumentType] : 'Документ';
}

export function getSafeDocumentStatus(status: unknown): DocumentStatus {
  return VALID_DOCUMENT_STATUSES.has(status as DocumentStatus) ? status as DocumentStatus : 'draft';
}

function nextContractNumber(documents: Doc[], kind: DocumentContractKind, date: string) {
  const year = (date || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const prefix = kind === 'rental' ? 'ДА' : 'ДП';
  const nextIndex = documents.filter(doc =>
    doc.type === 'contract'
    && doc.contractKind === kind
    && String(doc.date || '').slice(0, 4) === year,
  ).length + 1;

  return `${prefix}-${year}-${String(nextIndex).padStart(4, '0')}`;
}

function buildContractDraftHtml(params: {
  kind: DocumentContractKind;
  number: string;
  client: string;
  date: string;
  signatoryName: string;
  signatoryBasis: string;
  comment?: string;
}) {
  const { kind, number, client, date, signatoryName, signatoryBasis, comment } = params;
  return `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(number)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 32px;
            font-family: Arial, sans-serif;
            color: #111827;
            background: #fff;
          }
          .sheet {
            border: 1px solid #d1d5db;
            border-radius: 18px;
            padding: 28px;
          }
          h1 {
            margin: 0 0 10px;
            font-size: 24px;
          }
          h2 {
            margin: 26px 0 10px;
            font-size: 16px;
          }
          p {
            margin: 0 0 8px;
            font-size: 14px;
            line-height: 1.6;
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin-top: 18px;
          }
          .box {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 14px;
            background: #f9fafb;
          }
          .label {
            margin-bottom: 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .08em;
            color: #6b7280;
          }
          .placeholder {
            margin-top: 20px;
            padding: 16px;
            border-radius: 12px;
            background: #eff6ff;
            color: #1e3a8a;
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>${escapeHtml(getContractKindLabel(kind))}</h1>
          <p><strong>Номер:</strong> ${escapeHtml(number)}</p>
          <p><strong>Дата договора:</strong> ${escapeHtml(formatDate(date))}</p>
          <p><strong>Клиент:</strong> ${escapeHtml(client)}</p>

          <div class="meta">
            <div class="box">
              <div class="label">Подписант</div>
              <div>${escapeHtml(signatoryName)}</div>
            </div>
            <div class="box">
              <div class="label">Основание подписания</div>
              <div>${escapeHtml(signatoryBasis)}</div>
            </div>
          </div>

          ${comment
            ? `<h2>Комментарий</h2><p>${escapeHtml(comment).replaceAll('\n', '<br />')}</p>`
            : ''}

          <div class="placeholder">
            Шаблон основного текста договора будет подставлен позже. Сейчас система уже сохраняет договор в реестре, присваивает номер и фиксирует реквизиты подписанта.
          </div>
        </div>
      </body>
    </html>
  `;
}

export default function Documents() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canManageDocuments = can('create', 'documents') || can('edit', 'documents');
  const { data: documentList = [] } = useDocumentsList();
  const { data: clients = [] } = useClientsList();
  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument();
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
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [createContractKind, setCreateContractKind] = React.useState<DocumentContractKind>('rental');
  const [contractForm, setContractForm] = React.useState<ContractFormState>({
    clientId: '',
    client: '',
    signatoryName: '',
    signatoryBasis: '',
    date: new Date().toISOString().slice(0, 10),
    comment: '',
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const signedScanInputRef = React.useRef<HTMLInputElement | null>(null);
  const [signedScanTargetDoc, setSignedScanTargetDoc] = React.useState<Doc | null>(null);
  const documents = Array.isArray(documentList) ? documentList : [];
  const mechanicList = Array.isArray(mechanics) ? mechanics : [];

  React.useEffect(() => {
    setMechanicDocuments(Array.isArray(mechanicDocsData) ? mechanicDocsData : []);
  }, [mechanicDocsData]);

  React.useEffect(() => {
    if (!selectedMechanicId && mechanicList.length > 0) {
      setSelectedMechanicId(mechanicList[0].id);
    }
  }, [mechanicList, selectedMechanicId]);

  const filteredDocuments = documents.filter(doc => {
    const q = search.trim().toLowerCase();
    const matchesSearch = q === ''
      || searchText(doc.number).includes(q)
      || searchText(doc.client).includes(q)
      || getDocumentTypeLabel(doc).toLowerCase().includes(q)
      || searchText(doc.signatoryName).includes(q)
      || searchText(doc.signatoryBasis).includes(q);

    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const activeFilterCount = [
    search.trim() !== '',
    typeFilter !== 'all',
    statusFilter !== 'all',
  ].filter(Boolean).length;

  const filteredMechanics = React.useMemo(() => (
    mechanicList
      .filter(item => item.status === 'active')
      .filter(item => {
        const query = mechanicSearch.trim().toLowerCase();
        if (!query) return true;
        return item.name.toLowerCase().includes(query) || (item.phone || '').toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  ), [mechanicSearch, mechanicList]);

  const selectedMechanic = filteredMechanics.find(item => item.id === selectedMechanicId)
    || mechanicList.find(item => item.id === selectedMechanicId)
    || null;

  const selectedMechanicDocuments = React.useMemo(
    () => mechanicDocuments
      .filter(item => item.mechanicId === selectedMechanicId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [mechanicDocuments, selectedMechanicId],
  );

  const generatedContractNumber = React.useMemo(
    () => nextContractNumber(documents, createContractKind, contractForm.date),
    [createContractKind, contractForm.date, documents],
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

  function openContractCreate(kind: DocumentContractKind) {
    setCreateContractKind(kind);
    setContractForm({
      clientId: '',
      client: '',
      signatoryName: '',
      signatoryBasis: '',
      date: new Date().toISOString().slice(0, 10),
      comment: '',
    });
    setCreateDialogOpen(true);
  }

  async function handleCreateContract() {
    if (!contractForm.clientId || !contractForm.client.trim()) {
      toast.error('Выберите клиента.');
      return;
    }
    if (!contractForm.signatoryName.trim()) {
      toast.error('Укажите, кто подписывает договор.');
      return;
    }
    if (!contractForm.signatoryBasis.trim()) {
      toast.error('Укажите основание подписания.');
      return;
    }
    if (!contractForm.date) {
      toast.error('Укажите дату договора.');
      return;
    }

    const payload: Omit<Doc, 'id'> = {
      type: 'contract',
      contractKind: createContractKind,
      number: generatedContractNumber,
      clientId: contractForm.clientId,
      client: contractForm.client.trim(),
      date: contractForm.date,
      status: 'draft',
      signatoryName: contractForm.signatoryName.trim(),
      signatoryBasis: contractForm.signatoryBasis.trim(),
      manager: user?.name || 'Система',
      contentHtml: buildContractDraftHtml({
        kind: createContractKind,
        number: generatedContractNumber,
        client: contractForm.client.trim(),
        date: contractForm.date,
        signatoryName: contractForm.signatoryName.trim(),
        signatoryBasis: contractForm.signatoryBasis.trim(),
        comment: contractForm.comment.trim() || undefined,
      }),
    };

    await createDocument.mutateAsync(payload);
    setCreateDialogOpen(false);
    toast.success(`${getContractKindLabel(createContractKind)} создан.`);
  }

  function openDocument(doc: Doc) {
    if (doc.contentHtml) {
      openPrintableHtml(doc.contentHtml);
      return;
    }
    if (doc.signedScanDataUrl) {
      openDataUrl(doc.signedScanDataUrl);
    }
  }

  function downloadDocument(doc: Doc) {
    if (doc.contentHtml) {
      downloadPrintableHtml(doc.contentHtml, `${displayText(doc.number, 'document')}.html`);
      return;
    }
    if (doc.signedScanDataUrl) {
      downloadDataUrl(doc.signedScanDataUrl, doc.signedScanFileName || displayText(doc.number, 'document'));
    }
  }

  function startMarkAsSigned(doc: Doc) {
    setSignedScanTargetDoc(doc);
    signedScanInputRef.current?.click();
  }

  async function handleSignedScanUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const targetDoc = signedScanTargetDoc;
    event.target.value = '';
    if (!file || !targetDoc) return;

    try {
      const dataUrl = await fileToDataUrl(file);
      await updateDocument.mutateAsync({
        id: targetDoc.id,
        data: {
          status: 'signed',
          signedScanDataUrl: dataUrl,
          signedScanFileName: file.name,
          signedScanMimeType: file.type || 'application/octet-stream',
          signedAt: new Date().toISOString(),
          signedBy: user?.name || 'Система',
        },
      });
      toast.success(`Скан загружен, договор ${targetDoc.number} отмечен как подписанный.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить скан договора.');
    } finally {
      setSignedScanTargetDoc(null);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Документы</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Реестр договоров, актов, счетов, заказ-нарядов и данных по механикам.
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManageDocuments ? (
              <>
                <Button variant="secondary" onClick={() => openContractCreate('rental')}>
                  <Plus className="h-4 w-4" />
                  Договор аренды
                </Button>
                <Button variant="secondary" onClick={() => openContractCreate('supply')}>
                  <Plus className="h-4 w-4" />
                  Договор поставки
                </Button>
              </>
            ) : null}
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
                    placeholder="Поиск по номеру, клиенту, подписанту..."
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

          <input
            ref={signedScanInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleSignedScanUpload}
          />

          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Тип</TableHead>
                  <TableHead>Номер</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Подписант</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[160px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc, index) => (
                  <TableRow key={doc.id || doc.number || index}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{getDocumentTypeLabel(doc)}</p>
                        {doc.contractKind ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {doc.contractKind === 'rental' ? 'Реестр аренды' : 'Реестр поставки'}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{displayText(doc.number)}</p>
                        {doc.signedScanFileName ? (
                          <p className="text-xs text-green-600 dark:text-green-400">Скан загружен</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{displayText(doc.client)}</p>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{doc.signatoryName || '—'}</p>
                        {doc.signatoryBasis ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{doc.signatoryBasis}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{formatDate(String(doc.date || ''))}</p>
                        {doc.signedAt ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(doc.signedAt)}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{getDocumentStatusBadge(getSafeDocumentStatus(doc.status))}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openDocument(doc)}
                          disabled={!doc.contentHtml && !doc.signedScanDataUrl}
                          className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={doc.contentHtml || doc.signedScanDataUrl ? 'Просмотр' : 'Просмотр недоступен'}
                        >
                          <Eye className={`h-4 w-4 ${doc.contentHtml || doc.signedScanDataUrl ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`} />
                        </button>
                        <button
                          onClick={() => downloadDocument(doc)}
                          disabled={!doc.contentHtml && !doc.signedScanDataUrl}
                          className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={doc.contentHtml || doc.signedScanDataUrl ? 'Скачать' : 'Скачать недоступно'}
                        >
                          <Download className={`h-4 w-4 ${doc.contentHtml || doc.signedScanDataUrl ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`} />
                        </button>
                        {canManageDocuments && doc.type === 'contract' ? (
                          <button
                            onClick={() => startMarkAsSigned(doc)}
                            className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                            title={doc.signedScanDataUrl ? 'Заменить скан подписанного договора' : 'Загрузить скан и отметить как подписанный'}
                          >
                            {doc.status === 'signed' ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <Upload className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                            )}
                          </button>
                        ) : null}
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
              <p>Показано {filteredDocuments.length} из {documents.length} документов</p>
            </div>
          )}

          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5" />
                  {getContractKindLabel(createContractKind)}
                </DialogTitle>
                <DialogDescription>
                  Система сама назначит номер договора из реестра. Шаблон основного текста договора подставим позже.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Номер договора</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{generatedContractNumber}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Клиент</div>
                  <ClientCombobox
                    clients={clients as Client[]}
                    value={contractForm.client}
                    valueId={contractForm.clientId}
                    onChange={(value) => setContractForm(current => ({ ...current, client: value }))}
                    onClientSelect={(client) => setContractForm(current => ({
                      ...current,
                      clientId: client?.id ?? '',
                      client: client?.company ?? '',
                    }))}
                    placeholder="Выберите клиента из базы"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Кто подписант</div>
                    <Input
                      value={contractForm.signatoryName}
                      onChange={(event) => setContractForm(current => ({ ...current, signatoryName: event.target.value }))}
                      placeholder="Например, Иванов Иван Иванович"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Дата договора</div>
                    <Input
                      type="date"
                      value={contractForm.date}
                      onChange={(event) => setContractForm(current => ({ ...current, date: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">На основании какого документа подписывает</div>
                  <Input
                    value={contractForm.signatoryBasis}
                    onChange={(event) => setContractForm(current => ({ ...current, signatoryBasis: event.target.value }))}
                    placeholder="Например, Устава / Доверенности №... от ..."
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Комментарий</div>
                  <Textarea
                    rows={3}
                    value={contractForm.comment}
                    onChange={(event) => setContractForm(current => ({ ...current, comment: event.target.value }))}
                    placeholder="Необязательно. Можно оставить служебную пометку для офиса."
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setCreateDialogOpen(false)}>
                  Отмена
                </Button>
                <Button
                  onClick={() => void handleCreateContract()}
                  className="bg-lime-300 text-slate-950 hover:bg-lime-200"
                  disabled={createDocument.isPending}
                >
                  Создать договор
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
