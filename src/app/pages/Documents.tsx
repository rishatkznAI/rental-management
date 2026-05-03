import React from 'react';
import { useSearchParams } from 'react-router-dom';
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
  AlertTriangle,
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
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { buildDocumentControl, getDocumentControlStatusLabel } from '../lib/documentControl.js';
import {
  buildQuickActionContext,
  contextFilterLabel,
  hasClientContext,
  matchesClientContext,
  normalizeContextName,
} from '../lib/quickActionContext.js';
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
  Equipment,
  Mechanic,
  MechanicDocument,
  Rental,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type DocumentsView = 'general' | 'control' | 'mechanics';

const VALID_DOCUMENT_TYPES = new Set<DocumentType>(['contract', 'act', 'invoice', 'work_order']);
const VALID_DOCUMENT_STATUSES = new Set<DocumentStatus>(['draft', 'signed', 'sent']);

type ContractFormState = {
  clientId: string;
  client: string;
  rentalId: string;
  equipmentId: string;
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

function getDocumentRentalId(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.rentalId || doc?.rental, '');
}

function getDocumentEquipmentId(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.equipmentId, '');
}

function getDocumentEquipmentInv(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.equipmentInv || doc?.equipment, '');
}

function getRentalSourceId(entry: GanttRentalData) {
  return entry.rentalId || entry.sourceRentalId || entry.originalRentalId || '';
}

function getRentalLabel(rental: Rental | undefined) {
  if (!rental) return '';
  const start = rental.startDate ? formatDate(rental.startDate) : '';
  return [rental.id, rental.client, start].filter(Boolean).join(' · ');
}

function getEquipmentLabel(item: Equipment | undefined) {
  if (!item) return '';
  return [item.inventoryNumber, item.manufacturer, item.model].filter(Boolean).join(' · ');
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
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canManageDocuments = can('create', 'documents') || can('edit', 'documents');
  const { data: documentList = [] } = useDocumentsList();
  const { data: clients = [] } = useClientsList();
  const { data: rentals = [] } = useRentalsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: equipment = [] } = useEquipmentList();
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
  const [unsignedOnly, setUnsignedOnly] = React.useState(false);
  const [clientFilter, setClientFilter] = React.useState<string>('all');
  const [rentalFilter, setRentalFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [managerFilter, setManagerFilter] = React.useState<string>('all');
  const [controlRiskFilter, setControlRiskFilter] = React.useState<string>('all');
  const [controlStatusFilter, setControlStatusFilter] = React.useState<string>('all');
  const [controlTypeFilter, setControlTypeFilter] = React.useState<string>('all');
  const [controlClientFilter, setControlClientFilter] = React.useState<string>('all');
  const [controlManagerFilter, setControlManagerFilter] = React.useState<string>('all');
  const [controlOnlyOverdue, setControlOnlyOverdue] = React.useState(false);
  const [controlOnlyClosedMissing, setControlOnlyClosedMissing] = React.useState(false);
  const [controlOnlyUnsigned, setControlOnlyUnsigned] = React.useState(false);
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
    rentalId: '',
    equipmentId: '',
    signatoryName: '',
    signatoryBasis: '',
    date: new Date().toISOString().slice(0, 10),
    comment: '',
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const signedScanInputRef = React.useRef<HTMLInputElement | null>(null);
  const appliedQuickActionRef = React.useRef('');
  const [signedScanTargetDoc, setSignedScanTargetDoc] = React.useState<Doc | null>(null);
  const documents = Array.isArray(documentList) ? documentList : [];
  const mechanicList = Array.isArray(mechanics) ? mechanics : [];
  const quickActionContext = React.useMemo(() => buildQuickActionContext(searchParams), [searchParams]);
  const hasQuickClientContext = hasClientContext(quickActionContext);

  React.useEffect(() => {
    setMechanicDocuments(Array.isArray(mechanicDocsData) ? mechanicDocsData : []);
  }, [mechanicDocsData]);

  React.useEffect(() => {
    if (!selectedMechanicId && mechanicList.length > 0) {
      setSelectedMechanicId(mechanicList[0].id);
    }
  }, [mechanicList, selectedMechanicId]);

  const clientsById = React.useMemo(
    () => new Map((clients as Client[]).map(client => [client.id, client])),
    [clients],
  );
  const rentalsById = React.useMemo(
    () => new Map((rentals as Rental[]).map(rental => [rental.id, rental])),
    [rentals],
  );
  const ganttByRentalId = React.useMemo(() => {
    const map = new Map<string, GanttRentalData>();
    (ganttRentals as GanttRentalData[]).forEach(entry => {
      const rentalId = getRentalSourceId(entry);
      if (rentalId && !map.has(rentalId)) map.set(rentalId, entry);
    });
    return map;
  }, [ganttRentals]);
  const equipmentById = React.useMemo(
    () => new Map((equipment as Equipment[]).map(item => [item.id, item])),
    [equipment],
  );
  const equipmentByInventory = React.useMemo(
    () => new Map((equipment as Equipment[])
      .filter(item => item.inventoryNumber)
      .map(item => [item.inventoryNumber, item])),
    [equipment],
  );
  const quickActionClient = React.useMemo(() => {
    if (quickActionContext.clientId) {
      return clientsById.get(quickActionContext.clientId);
    }
    const wantedName = normalizeContextName(quickActionContext.clientName);
    if (!wantedName) return undefined;
    return (clients as Client[]).find(client => normalizeContextName(client.company) === wantedName);
  }, [clients, clientsById, quickActionContext.clientId, quickActionContext.clientName]);
  const quickActionRental = quickActionContext.rentalId ? rentalsById.get(quickActionContext.rentalId) : undefined;
  const quickActionEquipment = React.useMemo(() => {
    if (quickActionContext.equipmentId) return equipmentById.get(quickActionContext.equipmentId);
    if (quickActionContext.equipmentInv) return equipmentByInventory.get(quickActionContext.equipmentInv);
    return undefined;
  }, [equipmentById, equipmentByInventory, quickActionContext.equipmentId, quickActionContext.equipmentInv]);
  const relatedRentals = React.useMemo(() => {
    if (!contractForm.clientId && !contractForm.client) return rentals as Rental[];
    return (rentals as Rental[]).filter(rental => (
      rental.clientId === contractForm.clientId
      || rental.client === contractForm.client
    ));
  }, [contractForm.client, contractForm.clientId, rentals]);
  const selectedRental = contractForm.rentalId ? rentalsById.get(contractForm.rentalId) : undefined;
  const rentalEquipmentIds = React.useMemo(() => {
    if (!selectedRental) return new Set<string>();
    const gantt = ganttByRentalId.get(selectedRental.id);
    return new Set([
      ...(gantt?.equipmentId ? [gantt.equipmentId] : []),
      ...(selectedRental.equipment || [])
        .map(inv => equipmentByInventory.get(inv)?.id)
        .filter(Boolean) as string[],
    ]);
  }, [equipmentByInventory, ganttByRentalId, selectedRental]);
  const availableEquipment = React.useMemo(() => {
    const list = equipment as Equipment[];
    if (!selectedRental || rentalEquipmentIds.size === 0) return list;
    return list.filter(item => rentalEquipmentIds.has(item.id));
  }, [equipment, rentalEquipmentIds, selectedRental]);
  const managerOptions = React.useMemo(() => {
    const names = new Set<string>();
    documents.forEach(doc => {
      if (displayText(doc.manager, '')) names.add(displayText(doc.manager, ''));
      const rentalId = getDocumentRentalId(doc);
      const rental = rentalId ? rentalsById.get(rentalId) : undefined;
      if (displayText(rental?.manager, '')) names.add(displayText(rental?.manager, ''));
    });
    (rentals as Rental[]).forEach(rental => {
      if (displayText(rental.manager, '')) names.add(displayText(rental.manager, ''));
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [documents, rentals, rentalsById]);

  React.useEffect(() => {
    const hasContext = hasClientContext(quickActionContext)
      || quickActionContext.rentalId
      || quickActionContext.equipmentId
      || quickActionContext.equipmentInv;
    if (!hasContext && quickActionContext.action !== 'create') return;

    setView('general');

    if (quickActionClient?.id) {
      setClientFilter(quickActionClient.id);
    } else if (quickActionRental?.clientId) {
      setClientFilter(quickActionRental.clientId);
    }
    if (quickActionContext.rentalId && rentalsById.has(quickActionContext.rentalId)) {
      setRentalFilter(quickActionContext.rentalId);
    }

    if (quickActionContext.action !== 'create' || !canManageDocuments) return;

    const actionKey = searchParams.toString();
    if (appliedQuickActionRef.current === actionKey) return;
    appliedQuickActionRef.current = actionKey;

    openContractCreate('rental', {
      clientId: quickActionClient?.id || quickActionRental?.clientId || quickActionContext.clientId,
      client: quickActionClient?.company || quickActionRental?.client || quickActionContext.clientName,
      rentalId: quickActionRental?.id || '',
      equipmentId: quickActionEquipment?.id || quickActionContext.equipmentId,
    });
  }, [
    canManageDocuments,
    quickActionClient,
    quickActionContext,
    quickActionEquipment,
    quickActionRental,
    rentalsById,
    searchParams,
  ]);

  const filteredDocuments = documents.filter(doc => {
    const q = search.trim().toLowerCase();
    const rentalId = getDocumentRentalId(doc);
    const equipmentId = getDocumentEquipmentId(doc);
    const equipmentInv = getDocumentEquipmentInv(doc);
    const rental = rentalId ? rentalsById.get(rentalId) : undefined;
    const gantt = rentalId ? ganttByRentalId.get(rentalId) : undefined;
    const equipmentItem = equipmentId
      ? equipmentById.get(equipmentId)
      : (equipmentInv ? equipmentByInventory.get(equipmentInv) : undefined);
    const normalizedClientId = doc.clientId || rental?.clientId || '';
    const normalizedClient = doc.client || rental?.client || clientsById.get(normalizedClientId)?.company || '';
    const normalizedManager = doc.manager || rental?.manager || gantt?.manager || '';
    const matchesSearch = q === ''
      || searchText(doc.number).includes(q)
      || searchText(normalizedClient).includes(q)
      || searchText(rentalId).includes(q)
      || searchText(equipmentInv).includes(q)
      || searchText(getEquipmentLabel(equipmentItem)).includes(q)
      || getDocumentTypeLabel(doc).toLowerCase().includes(q)
      || searchText(doc.signatoryName).includes(q)
      || searchText(doc.signatoryBasis).includes(q);

    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const safeStatus = getSafeDocumentStatus(doc.status);
    const matchesStatus = statusFilter === 'all' || safeStatus === statusFilter;
    const matchesUnsigned = !unsignedOnly || safeStatus !== 'signed';
    const matchesClient = clientFilter === 'all'
      || normalizedClientId === clientFilter
      || normalizedClient === clientsById.get(clientFilter)?.company;
    const matchesQuickClient = matchesClientContext({
      clientId: normalizedClientId,
      clientName: normalizedClient,
    }, quickActionContext);
    const matchesRental = rentalFilter === 'all' || rentalId === rentalFilter;
    const matchesManager = managerFilter === 'all' || normalizedManager === managerFilter;

    return matchesSearch && matchesType && matchesStatus && matchesUnsigned && matchesClient && matchesQuickClient && matchesRental && matchesManager;
  });

  const documentControl = React.useMemo(() => buildDocumentControl({
    rentals: rentals as Rental[],
    documents,
    clients: clients as Client[],
    equipment: equipment as Equipment[],
  }), [clients, documents, equipment, rentals]);
  const controlRows = documentControl.rows;
  const controlStatusOptions = React.useMemo(
    () => Array.from(new Set(controlRows.map(row => row.status))).sort((left, right) =>
      getDocumentControlStatusLabel(left).localeCompare(getDocumentControlStatusLabel(right), 'ru'),
    ),
    [controlRows],
  );
  const filteredControlRows = controlRows.filter(row => {
    const matchesRisk = controlRiskFilter === 'all' || row.risk === controlRiskFilter;
    const matchesStatus = controlStatusFilter === 'all' || row.status === controlStatusFilter;
    const matchesType = controlTypeFilter === 'all' || row.documentType === controlTypeFilter;
    const matchesClient = controlClientFilter === 'all' || row.clientId === controlClientFilter;
    const matchesManager = controlManagerFilter === 'all' || row.responsible === controlManagerFilter;
    const matchesOverdue = !controlOnlyOverdue || row.status === 'overdue_signature';
    const matchesClosedMissing = !controlOnlyClosedMissing || (row.status === 'missing_closing_docs' && row.rentalClosed);
    const matchesUnsigned = !controlOnlyUnsigned || ['unsigned', 'sent_waiting', 'overdue_signature'].includes(row.status);
    return matchesRisk && matchesStatus && matchesType && matchesClient && matchesManager && matchesOverdue && matchesClosedMissing && matchesUnsigned;
  });
  const controlTypeOptions = React.useMemo(
    () => Array.from(new Set(controlRows.map(row => row.documentType).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [controlRows],
  );

  const activeFilterCount = [
    search.trim() !== '',
    unsignedOnly,
    clientFilter !== 'all',
    rentalFilter !== 'all',
    typeFilter !== 'all',
    statusFilter !== 'all',
    managerFilter !== 'all',
  ].filter(Boolean).length;
  const controlActiveFilterCount = [
    controlRiskFilter !== 'all',
    controlStatusFilter !== 'all',
    controlTypeFilter !== 'all',
    controlClientFilter !== 'all',
    controlManagerFilter !== 'all',
    controlOnlyOverdue,
    controlOnlyClosedMissing,
    controlOnlyUnsigned,
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

  function openContractCreate(kind: DocumentContractKind, initial: Partial<ContractFormState> = {}) {
    setCreateContractKind(kind);
    setContractForm({
      clientId: '',
      client: '',
      rentalId: '',
      equipmentId: '',
      signatoryName: '',
      signatoryBasis: '',
      date: new Date().toISOString().slice(0, 10),
      comment: '',
      ...initial,
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
    const rental = contractForm.rentalId ? rentalsById.get(contractForm.rentalId) : undefined;
    const gantt = contractForm.rentalId ? ganttByRentalId.get(contractForm.rentalId) : undefined;
    const equipmentItem = contractForm.equipmentId ? equipmentById.get(contractForm.equipmentId) : undefined;
    if (contractForm.rentalId) {
      payload.rentalId = contractForm.rentalId;
      payload.rental = contractForm.rentalId;
    }
    if (contractForm.equipmentId) {
      payload.equipmentId = contractForm.equipmentId;
      payload.equipmentInv = equipmentItem?.inventoryNumber || gantt?.equipmentInv || rental?.equipment?.[0] || '';
      payload.equipment = payload.equipmentInv;
    }

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
            variant={view === 'control' ? 'default' : 'secondary'}
            onClick={() => setView('control')}
          >
            <AlertTriangle className="h-4 w-4" />
            Контроль
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
            description="Отбери документы по подписи, связям, типу, статусу и менеджеру."
            onReset={() => {
              setSearch('');
              setUnsignedOnly(false);
              setClientFilter('all');
              setRentalFilter('all');
              setTypeFilter('all');
              setStatusFilter('all');
              setManagerFilter('all');
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
              <FilterField label="Подпись">
                <Button
                  type="button"
                  variant={unsignedOnly ? 'default' : 'secondary'}
                  onClick={() => setUnsignedOnly(value => !value)}
                  className="w-full justify-start"
                >
                  <FileSignature className="h-4 w-4" />
                  Без подписи
                </Button>
              </FilterField>
              <FilterField label="Клиент">
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все клиенты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клиенты</SelectItem>
                    {(clients as Client[]).map(client => (
                      <SelectItem key={client.id} value={client.id}>{client.company}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Аренда">
                <Select value={rentalFilter} onValueChange={setRentalFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все аренды" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все аренды</SelectItem>
                    {(rentals as Rental[]).map(rental => (
                      <SelectItem key={rental.id} value={rental.id}>{getRentalLabel(rental)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    <SelectItem value="sent">Отправлен</SelectItem>
                    <SelectItem value="signed">Подписан</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Ответственный менеджер">
                <Select value={managerFilter} onValueChange={setManagerFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все менеджеры" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все менеджеры</SelectItem>
                    {managerOptions.map(manager => (
                      <SelectItem key={manager} value={manager}>{manager}</SelectItem>
                    ))}
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
                  <TableHead>Аренда</TableHead>
                  <TableHead>Техника</TableHead>
                  <TableHead>Подписант</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[160px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc, index) => {
                  const rentalId = getDocumentRentalId(doc);
                  const equipmentId = getDocumentEquipmentId(doc);
                  const equipmentInv = getDocumentEquipmentInv(doc);
                  const rental = rentalId ? rentalsById.get(rentalId) : undefined;
                  const gantt = rentalId ? ganttByRentalId.get(rentalId) : undefined;
                  const equipmentItem = equipmentId
                    ? equipmentById.get(equipmentId)
                    : (equipmentInv ? equipmentByInventory.get(equipmentInv) : undefined);
                  const clientName = doc.client || rental?.client || clientsById.get(doc.clientId || '')?.company;
                  const managerName = doc.manager || rental?.manager || gantt?.manager;
                  return (
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
                      <p className="text-sm">{displayText(clientName)}</p>
                      {managerName ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{managerName}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{displayText(rentalId)}</p>
                      {rental?.startDate ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(rental.startDate)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{displayText(equipmentInv || equipmentItem?.inventoryNumber)}</p>
                      {equipmentItem ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{displayText(`${equipmentItem.manufacturer || ''} ${equipmentItem.model || ''}`.trim())}</p>
                      ) : null}
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
                  );
                })}
              </TableBody>
            </Table>

            {filteredDocuments.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                  <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  {hasQuickClientContext ? 'Документы по клиенту не найдены' : 'Документы не найдены'}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {hasQuickClientContext
                    ? `Для ${contextFilterLabel(quickActionContext)} нет документов по выбранным фильтрам`
                    : 'Попробуйте изменить параметры поиска или фильтры'}
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
                    onChange={(value) => setContractForm(current => ({
                      ...current,
                      client: value,
                      rentalId: '',
                      equipmentId: '',
                    }))}
                    onClientSelect={(client) => setContractForm(current => ({
                      ...current,
                      clientId: client?.id ?? '',
                      client: client?.company ?? '',
                      rentalId: '',
                      equipmentId: '',
                    }))}
                    placeholder="Выберите клиента из базы"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Связанная аренда</div>
                    <Select
                      value={contractForm.rentalId || 'none'}
                      onValueChange={(value) => setContractForm(current => ({
                        ...current,
                        rentalId: value === 'none' ? '' : value,
                        equipmentId: '',
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Без аренды" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без аренды</SelectItem>
                        {relatedRentals.map(rental => (
                          <SelectItem key={rental.id} value={rental.id}>{getRentalLabel(rental)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Связанная техника</div>
                    <Select
                      value={contractForm.equipmentId || 'none'}
                      onValueChange={(value) => setContractForm(current => ({
                        ...current,
                        equipmentId: value === 'none' ? '' : value,
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Без техники" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без техники</SelectItem>
                        {availableEquipment.map(item => (
                          <SelectItem key={item.id} value={item.id}>{getEquipmentLabel(item)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
      ) : view === 'control' ? (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Контроль документов</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Управленческий список аренд и документов, где не хватает договора, акта/УПД, подписи или ответственной связи.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            {[
              ['Всего документов', documentControl.kpi.totalDocuments],
              ['Без подписи', documentControl.kpi.unsignedDocuments],
              ['Отправлено без подписи', documentControl.kpi.sentWaiting],
              ['Аренды без договора', documentControl.kpi.rentalsWithoutContract],
              ['Закрытые без акта/УПД', documentControl.kpi.closedRentalsWithoutClosingDocs],
              ['Просрочено подписание', documentControl.kpi.overdueSignature],
              ['Документы без связи', documentControl.kpi.orphanDocuments],
            ].map(([label, value]) => (
              <div key={String(label)} className={`rounded-lg border p-4 ${
                Number(value) > 0 && label !== 'Всего документов'
                  ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
              }`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant={controlOnlyOverdue ? 'default' : 'secondary'} onClick={() => setControlOnlyOverdue(value => !value)}>
              Просроченные
            </Button>
            <Button variant={controlOnlyClosedMissing ? 'default' : 'secondary'} onClick={() => setControlOnlyClosedMissing(value => !value)}>
              Закрытые без акта/УПД
            </Button>
            <Button variant={controlOnlyUnsigned ? 'default' : 'secondary'} onClick={() => setControlOnlyUnsigned(value => !value)}>
              Без подписи
            </Button>
            <FilterButton activeCount={controlActiveFilterCount} onClick={() => setShowFilters(true)} />
          </div>

          <FilterDialog
            open={showFilters}
            onOpenChange={setShowFilters}
            title="Фильтры контроля документов"
            description="Отбери риски по статусу, типу документа, клиенту и ответственному."
            onReset={() => {
              setControlRiskFilter('all');
              setControlStatusFilter('all');
              setControlTypeFilter('all');
              setControlClientFilter('all');
              setControlManagerFilter('all');
              setControlOnlyOverdue(false);
              setControlOnlyClosedMissing(false);
              setControlOnlyUnsigned(false);
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FilterField label="Риск">
                <Select value={controlRiskFilter} onValueChange={setControlRiskFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все риски" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все риски</SelectItem>
                    <SelectItem value="critical">Критичный</SelectItem>
                    <SelectItem value="high">Высокий</SelectItem>
                    <SelectItem value="medium">Средний</SelectItem>
                    <SelectItem value="low">Низкий</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Статус контроля">
                <Select value={controlStatusFilter} onValueChange={setControlStatusFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все статусы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    {controlStatusOptions.map(status => (
                      <SelectItem key={status} value={status}>{getDocumentControlStatusLabel(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Тип документа">
                <Select value={controlTypeFilter} onValueChange={setControlTypeFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все типы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все типы</SelectItem>
                    {controlTypeOptions.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Клиент">
                <Select value={controlClientFilter} onValueChange={setControlClientFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все клиенты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клиенты</SelectItem>
                    {(clients as Client[]).map(client => (
                      <SelectItem key={client.id} value={client.id}>{client.company}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Ответственный">
                <Select value={controlManagerFilter} onValueChange={setControlManagerFilter}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Все ответственные" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все ответственные</SelectItem>
                    {managerOptions.map(manager => (
                      <SelectItem key={manager} value={manager}>{manager}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </div>
          </FilterDialog>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Риск</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Аренда</TableHead>
                  <TableHead>Техника</TableHead>
                  <TableHead>Документ</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Дней без подписи</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Ссылки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredControlRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        row.risk === 'critical'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          : row.risk === 'high'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                            : row.risk === 'medium'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      }`}>
                        {row.risk === 'critical' ? 'Критично' : row.risk === 'high' ? 'Высокий' : row.risk === 'medium' ? 'Средний' : 'Низкий'}
                      </span>
                    </TableCell>
                    <TableCell>{row.client}</TableCell>
                    <TableCell>{row.rentalId || '—'}</TableCell>
                    <TableCell>{row.equipment}</TableCell>
                    <TableCell>{row.documentType}</TableCell>
                    <TableCell>{row.statusLabel}</TableCell>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell>{row.daysWithoutSignature > 0 ? row.daysWithoutSignature : '—'}</TableCell>
                    <TableCell>{row.responsible}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        {row.rentalUrl ? <a className="text-[--color-primary] hover:underline" href={row.rentalUrl}>Открыть аренду</a> : null}
                        <a className="text-[--color-primary] hover:underline" href={row.documentsUrl}>Открыть документы</a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredControlRows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="mb-3 h-9 w-9 text-emerald-500" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Рисков по выбранным фильтрам нет</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Контроль документов не нашёл строк для действия.</p>
              </div>
            )}
          </div>
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
