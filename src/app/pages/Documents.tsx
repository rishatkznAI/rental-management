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
  ClipboardList,
  Download,
  Eye,
  FileSignature,
  MoreHorizontal,
  Plus,
  Printer,
  Route,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  Wrench,
  UserRound,
} from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { useClientsList } from '../hooks/useClients';
import {
  useAssignDocumentNumber,
  useCreateDocument,
  useDeleteDocument,
  useDuplicateDocument,
  useDocumentRegistrySummary,
  useDocumentsList,
  useGenerateDocument,
  useMarkDocumentSent,
  useMarkDocumentSigned,
  useUpdateDocument,
} from '../hooks/useDocuments';
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { buildDocumentControl, getDocumentControlStatusLabel } from '../lib/documentControl.js';
import { DOCUMENT_WORKSPACE_TYPES, getDocumentRegistryItem } from '../lib/documentRegistry';
import {
  buildQuickActionContext,
  contextFilterLabel,
  hasClientContext,
  matchesClientContext,
  normalizeContextName,
} from '../lib/quickActionContext.js';
import { downloadPrintableHtml, openPrintableHtml } from '../lib/serviceWorkOrder';
import { saleConditionKind } from '../lib/equipmentSaleMode.js';
import {
  SALES_SETTINGS_KEY,
  DEFAULT_SALES_SETTINGS,
  type QuoteTemplateSection,
  normalizeSalesSettings,
} from '../lib/salesSettings';
import { absoluteMediaUrl, photoSource } from '../lib/media';
import { formatDate, formatCurrency, formatDateTime } from '../lib/utils';
import { mechanicsService } from '../services/mechanics.service';
import { mechanicDocumentsService } from '../services/mechanic-documents.service';
import { appSettingsService } from '../services/app-settings.service';
import { deliveriesService } from '../services/deliveries.service';
import { serviceVehiclesService } from '../services/service-vehicles.service';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { normalizeUserRole } from '../lib/userStorage';
import type {
  Client,
  Document as Doc,
  DocumentContractKind,
  DocumentStatus,
  DocumentType,
  Delivery,
  Equipment,
  Mechanic,
  MechanicDocument,
  Rental,
  ServiceTicket,
  ServiceVehicle,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type DocumentsView = 'general' | 'control' | 'mechanics';

const VALID_DOCUMENT_TYPES = new Set<DocumentType>([
  'rental_contract',
  'rental_specification',
  'transfer_act_to_client',
  'return_act_from_client',
  'contract',
  'commercial_offer',
  'act',
  'upd',
  'invoice',
  'service_act',
  'work_order',
  'debt_notification',
  'pretrial_claim',
  'court_document',
  'court_decision',
  'enforcement_writ',
  'trip_ticket',
  'other',
]);
const VALID_DOCUMENT_STATUSES = new Set<DocumentStatus>(['draft', 'signed', 'sent', 'pending_signature', 'expired', 'cancelled']);

const DOCUMENT_ICON_MAP = {
  FileSignature,
  ClipboardList,
  Send,
  Route,
  Wrench,
} as const;

type DocumentQuickFilter =
  | 'all'
  | 'rental_contract'
  | 'rental_specification'
  | 'transfer_act_to_client'
  | 'return_act_from_client'
  | 'work_order'
  | 'trip_ticket'
  | 'unsigned'
  | 'overdue'
  | 'draft';

type DocumentWizardState = {
  type: DocumentType;
  clientId: string;
  rentalId: string;
  equipmentId: string;
  serviceTicketId: string;
  deliveryId: string;
  mechanicId: string;
  serviceCarId: string;
  parentDocumentId: string;
  dueDate: string;
  notes: string;
};

const EMPTY_WIZARD: DocumentWizardState = {
  type: 'rental_contract',
  clientId: '',
  rentalId: '',
  equipmentId: '',
  serviceTicketId: '',
  deliveryId: '',
  mechanicId: '',
  serviceCarId: '',
  parentDocumentId: '',
  dueDate: '',
  notes: '',
};

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

type CommercialOfferFormState = {
  clientId: string;
  client: string;
  equipmentId: string;
  date: string;
  price: string;
  validUntil: string;
  defaultPaymentTerms: string;
  defaultDeliveryTerms: string;
  warrantyTerms: string;
  kitComment: string;
  comment: string;
};

const EMPTY_MECHANICS: Mechanic[] = [];
const EMPTY_MECHANIC_DOCUMENTS: MechanicDocument[] = [];

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
  const registryItem = getDocumentRegistryItem(doc?.type);
  if (registryItem) return registryItem.label;
  const labels: Record<DocumentType, string> = {
    rental_contract: 'Договор аренды',
    rental_specification: 'Спецификация к договору',
    transfer_act_to_client: 'Акт передачи клиенту',
    return_act_from_client: 'Акт возврата от клиента',
    trip_ticket: 'Путевой лист',
    contract: getContractKindLabel(doc?.contractKind),
    commercial_offer: 'Коммерческое предложение',
    act: 'Акт',
    upd: 'УПД',
    invoice: 'Счёт',
    service_act: 'Сервисный акт',
    work_order: 'Заказ-наряд',
    debt_notification: 'Уведомление о задолженности',
    pretrial_claim: 'Досудебная претензия',
    court_document: 'Судебный документ',
    court_decision: 'Решение суда',
    enforcement_writ: 'Исполнительный лист',
    other: 'Прочее',
  };
  const type = doc?.type;
  return VALID_DOCUMENT_TYPES.has(type as DocumentType) ? labels[type as DocumentType] : 'Документ';
}

export function getSafeDocumentStatus(status: unknown): DocumentStatus {
  return VALID_DOCUMENT_STATUSES.has(status as DocumentStatus) ? status as DocumentStatus : 'draft';
}

function getDocumentStatusLabel(status: unknown) {
  const safe = getSafeDocumentStatus(status);
  if (safe === 'signed') return 'Подписан';
  if (safe === 'sent') return 'Отправлен';
  if (safe === 'pending_signature') return 'На подписи';
  if (safe === 'expired') return 'Просрочен';
  if (safe === 'cancelled') return 'Отменён';
  return 'Черновик';
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

function getDocumentNumber(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.documentNumber || doc?.number, '');
}

function getDocumentDate(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.documentDate || doc?.date, '');
}

function getDocumentServiceTicket(doc: Partial<Doc> | null | undefined) {
  return displayText(doc?.serviceTicketId || doc?.serviceTicket, '');
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
  title: string;
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

function buildCommercialOfferHtml(params: {
  number: string;
  title: string;
  client: string;
  date: string;
  validUntil: string;
  equipmentLabel: string;
  inventoryNumber: string;
  serialNumber: string;
  equipmentPhoto: string;
  equipmentSpecs: Array<{ label: string; value: string }>;
  equipmentPackage: string;
  price: string;
  introText: string;
  footerText: string;
  showVat: boolean;
  showEquipmentPhoto: boolean;
  showEquipmentSpecs: boolean;
  showEquipmentPackage: boolean;
  showPaymentTerms: boolean;
  showDeliveryTerms: boolean;
  showWarrantyTerms: boolean;
  showPackageComment: boolean;
  sectionsOrder: QuoteTemplateSection[];
  defaultPaymentTerms: string;
  defaultDeliveryTerms: string;
  warrantyTerms: string;
  kitComment: string;
  comment?: string;
}) {
  const {
    number,
    title,
    client,
    date,
    validUntil,
    equipmentLabel,
    inventoryNumber,
    serialNumber,
    equipmentPhoto,
    equipmentSpecs,
    equipmentPackage,
    price,
    introText,
    footerText,
    showVat,
    showEquipmentPhoto,
    showEquipmentSpecs,
    showEquipmentPackage,
    showPaymentTerms,
    showDeliveryTerms,
    showWarrantyTerms,
    showPackageComment,
    sectionsOrder,
    defaultPaymentTerms,
    defaultDeliveryTerms,
    warrantyTerms,
    kitComment,
    comment,
  } = params;
  const sectionHtml: Record<QuoteTemplateSection, string> = {
    intro: introText ? `<p>${escapeHtml(introText).replaceAll('\n', '<br />')}</p>` : '',
    equipment: `
      <h2>Техника</h2>
      <div class="grid">
        ${showEquipmentPhoto && equipmentPhoto ? `<div class="box media"><img src="${escapeHtml(equipmentPhoto)}" alt="${escapeHtml(equipmentLabel)}" /></div>` : ''}
        <div class="box"><div class="label">Модель</div><div>${escapeHtml(equipmentLabel)}</div></div>
        <div class="box"><div class="label">Идентификация</div><div>Инв. № ${escapeHtml(inventoryNumber)} · SN ${escapeHtml(serialNumber)}</div></div>
        ${showEquipmentSpecs ? equipmentSpecs.map(spec => `
          <div class="box"><div class="label">${escapeHtml(spec.label)}</div><div>${escapeHtml(spec.value)}</div></div>
        `).join('') : ''}
      </div>
    `,
    price: `<h2>Цена</h2><div class="box"><div class="label">Цена продажи</div><div class="price">${escapeHtml(price)}</div>${showVat ? '<div class="muted">НДС включён, если не указано иное.</div>' : '<div class="muted">НДС не включён.</div>'}</div>`,
    payment: showPaymentTerms ? `<h2>Условия оплаты</h2><p>${escapeHtml(defaultPaymentTerms).replaceAll('\n', '<br />')}</p>` : '',
    delivery: showDeliveryTerms ? `<h2>Условия доставки</h2><p>${escapeHtml(defaultDeliveryTerms).replaceAll('\n', '<br />')}</p>` : '',
    warranty: showWarrantyTerms ? `<h2>Гарантийные условия</h2><p>${escapeHtml(warrantyTerms).replaceAll('\n', '<br />')}</p>` : '',
    package: showEquipmentPackage ? `<h2>Комплектация</h2><p>${escapeHtml(equipmentPackage).replaceAll('\n', '<br />')}</p>` : '',
    packageComment: showPackageComment ? `<h2>Комментарий по комплектации</h2><p>${escapeHtml(kitComment).replaceAll('\n', '<br />')}</p>` : '',
    footer: footerText ? `<h2>Примечание</h2><p>${escapeHtml(footerText).replaceAll('\n', '<br />')}</p>` : '',
  };
  const orderedSections = sectionsOrder.length > 0 ? sectionsOrder : DEFAULT_SALES_SETTINGS.quoteTemplate.sectionsOrder;
  return `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(number)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 32px; font-family: Arial, sans-serif; color: #111827; background: #fff; }
          .sheet { border: 1px solid #d1d5db; border-radius: 18px; padding: 28px; }
          h1 { margin: 0 0 12px; font-size: 24px; }
          h2 { margin: 24px 0 8px; font-size: 16px; }
          p { margin: 0 0 8px; font-size: 14px; line-height: 1.6; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
          .box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; background: #f9fafb; }
          .label { margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; }
          .price { font-size: 24px; font-weight: 700; color: #0f172a; }
          .muted { margin-top: 6px; font-size: 12px; color: #6b7280; }
          .media { grid-column: 1 / -1; padding: 0; overflow: hidden; background: #fff; }
          .media img { display: block; width: 100%; max-height: 260px; object-fit: contain; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>${escapeHtml(title)}</h1>
          <p><strong>Номер:</strong> ${escapeHtml(number)}</p>
          <p><strong>Дата:</strong> ${escapeHtml(formatDate(date))}</p>
          <p><strong>Действует до:</strong> ${escapeHtml(formatDate(validUntil))}</p>
          <p><strong>Клиент:</strong> ${escapeHtml(client)}</p>
          ${orderedSections.map(section => sectionHtml[section]).filter(Boolean).join('\n')}
          ${comment ? `<h2>Комментарий</h2><p>${escapeHtml(comment).replaceAll('\n', '<br />')}</p>` : ''}
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
  const normalizedRole = normalizeUserRole(user?.role || user?.normalizedRole || user?.rawRole);
  const isAdmin = normalizedRole === 'Администратор';
  const canReadMechanics =
    isAdmin ||
    normalizedRole === 'Офис-менеджер' ||
    normalizedRole.includes('Механик');
  const { data: documentList = [] } = useDocumentsList();
  const { data: registrySummary } = useDocumentRegistrySummary();
  const { data: clients = [] } = useClientsList();
  const { data: rentals = [] } = useRentalsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: equipment = [] } = useEquipmentList();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const { data: deliveries = [] } = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'documents'],
    queryFn: deliveriesService.getAll,
  });
  const { data: serviceVehicles = [] } = useQuery<ServiceVehicle[]>({
    queryKey: ['service-vehicles', 'documents'],
    queryFn: serviceVehiclesService.getAll,
    enabled: canReadMechanics,
  });
  const createDocument = useCreateDocument();
  const generateDocument = useGenerateDocument();
  const updateDocument = useUpdateDocument();
  const assignDocumentNumber = useAssignDocumentNumber();
  const markDocumentSent = useMarkDocumentSent();
  const markDocumentSigned = useMarkDocumentSigned();
  const duplicateDocument = useDuplicateDocument();
  const deleteDocument = useDeleteDocument();
  const { data: mechanics = EMPTY_MECHANICS } = useQuery<Mechanic[]>({
    queryKey: ['mechanics'],
    queryFn: mechanicsService.getAll,
    enabled: canReadMechanics,
  });
  const { data: mechanicDocsData = EMPTY_MECHANIC_DOCUMENTS } = useQuery<MechanicDocument[]>({
    queryKey: ['mechanic-documents'],
    queryFn: mechanicDocumentsService.getAll,
  });
  const { data: appSettings = [] } = useQuery({
    queryKey: ['app-settings', 'documents-commercial-offer'],
    queryFn: isAdmin ? appSettingsService.getAll : appSettingsService.getPublic,
  });

  const [search, setSearch] = React.useState('');
  const [unsignedOnly, setUnsignedOnly] = React.useState(false);
  const [withoutNumberOnly, setWithoutNumberOnly] = React.useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = React.useState(false);
  const [clientFilter, setClientFilter] = React.useState<string>('all');
  const [rentalFilter, setRentalFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [managerFilter, setManagerFilter] = React.useState<string>('all');
  const [quickTypeFilter, setQuickTypeFilter] = React.useState<DocumentQuickFilter>('all');
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
  const [commercialOfferDialogOpen, setCommercialOfferDialogOpen] = React.useState(false);
  const [documentWizardOpen, setDocumentWizardOpen] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState(1);
  const [wizardForm, setWizardForm] = React.useState<DocumentWizardState>(EMPTY_WIZARD);
  const [selectedDocument, setSelectedDocument] = React.useState<Doc | null>(null);
  const [sortKey, setSortKey] = React.useState<'date' | 'number' | 'client' | 'status' | 'createdAt'>('date');
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
  const [commercialOfferForm, setCommercialOfferForm] = React.useState<CommercialOfferFormState>({
    clientId: '',
    client: '',
    equipmentId: '',
    date: new Date().toISOString().slice(0, 10),
    price: '',
    validUntil: '',
    defaultPaymentTerms: DEFAULT_SALES_SETTINGS.defaultPaymentTerms.paymentText,
    defaultDeliveryTerms: DEFAULT_SALES_SETTINGS.defaultDeliveryTerms.deliveryText,
    warrantyTerms: DEFAULT_SALES_SETTINGS.warrantyTerms.warrantyText,
    kitComment: DEFAULT_SALES_SETTINGS.packageCommentTemplate.text,
    comment: '',
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const signedScanInputRef = React.useRef<HTMLInputElement | null>(null);
  const appliedQuickActionRef = React.useRef('');
  const [signedScanTargetDoc, setSignedScanTargetDoc] = React.useState<Doc | null>(null);
  const documents = Array.isArray(documentList) ? documentList : [];
  const mechanicList = Array.isArray(mechanics) ? mechanics : [];
  const salesSettings = React.useMemo(() => {
    const record = appSettings.find(item => item.key === SALES_SETTINGS_KEY);
    return normalizeSalesSettings(record?.value);
  }, [appSettings]);
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
  const serviceTicketsById = React.useMemo(
    () => new Map((serviceTickets as ServiceTicket[]).map(item => [item.id, item])),
    [serviceTickets],
  );
  const deliveriesById = React.useMemo(
    () => new Map((deliveries as Delivery[]).map(item => [item.id, item])),
    [deliveries],
  );
  const mechanicsById = React.useMemo(
    () => new Map(mechanicList.map(item => [item.id, item])),
    [mechanicList],
  );
  const serviceVehiclesById = React.useMemo(
    () => new Map((serviceVehicles as ServiceVehicle[]).map(item => [item.id, item])),
    [serviceVehicles],
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

  const duplicateDocumentIds = React.useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach(doc => {
      const number = getDocumentNumber(doc).toLowerCase();
      if (!number) return;
      const year = getDocumentDate(doc).slice(0, 4);
      const key = `${doc.type}:${year}:${number}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicates = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
    return new Set(documents
      .filter(doc => duplicates.has(`${doc.type}:${getDocumentDate(doc).slice(0, 4)}:${getDocumentNumber(doc).toLowerCase()}`))
      .map(doc => doc.id));
  }, [documents]);

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
    if (quickActionContext.rentalId && !quickActionRental) return;

    const actionKey = searchParams.toString();
    if (appliedQuickActionRef.current === actionKey) return;
    appliedQuickActionRef.current = actionKey;

    const requestedType = String(searchParams.get('type') || searchParams.get('documentType') || '').toLowerCase();
    if (['commercial_offer', 'quote', 'kp', 'кп'].includes(requestedType)) {
      openCommercialOfferCreate({
        clientId: quickActionClient?.id || quickActionRental?.clientId || quickActionContext.clientId,
        client: quickActionClient?.company || quickActionRental?.client || quickActionContext.clientName,
        equipmentId: quickActionEquipment?.id || quickActionContext.equipmentId,
      });
    } else {
      openContractCreate('rental', {
        clientId: quickActionClient?.id || quickActionRental?.clientId || quickActionContext.clientId,
        client: quickActionClient?.company || quickActionRental?.client || quickActionContext.clientName,
        rentalId: quickActionRental?.id || '',
        equipmentId: quickActionEquipment?.id || quickActionContext.equipmentId,
      });
    }
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
    const docNumber = getDocumentNumber(doc);
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
      || searchText(docNumber).includes(q)
      || searchText(doc.number).includes(q)
      || searchText(normalizedClient).includes(q)
      || searchText(rentalId).includes(q)
      || searchText(equipmentInv).includes(q)
      || searchText(getEquipmentLabel(equipmentItem)).includes(q)
      || searchText(getDocumentServiceTicket(doc)).includes(q)
      || searchText(doc.deliveryId).includes(q)
      || getDocumentTypeLabel(doc).toLowerCase().includes(q)
      || searchText(doc.signatoryName).includes(q)
      || searchText(doc.signatoryBasis).includes(q);

    const matchesType = typeFilter === 'all' || doc.type === typeFilter;
    const safeStatus = getSafeDocumentStatus(doc.status);
    const matchesStatus = statusFilter === 'all' || safeStatus === statusFilter;
    const matchesUnsigned = !unsignedOnly || safeStatus !== 'signed';
    const matchesWithoutNumber = !withoutNumberOnly || !docNumber;
    const matchesDuplicates = !duplicatesOnly || duplicateDocumentIds.has(doc.id);
    const matchesClient = clientFilter === 'all'
      || normalizedClientId === clientFilter
      || normalizedClient === clientsById.get(clientFilter)?.company;
    const matchesQuickClient = matchesClientContext({
      clientId: normalizedClientId,
      clientName: normalizedClient,
    }, quickActionContext);
    const matchesRental = rentalFilter === 'all' || rentalId === rentalFilter;
    const matchesManager = managerFilter === 'all' || normalizedManager === managerFilter;
    const isUnsigned = safeStatus !== 'signed' && safeStatus !== 'cancelled';
    const isOverdue = safeStatus === 'expired' || Boolean(doc.dueDate && doc.dueDate < new Date().toISOString().slice(0, 10) && isUnsigned);
    const matchesQuickType = quickTypeFilter === 'all'
      || (quickTypeFilter === 'unsigned' && isUnsigned)
      || (quickTypeFilter === 'overdue' && isOverdue)
      || (quickTypeFilter === 'draft' && safeStatus === 'draft')
      || doc.type === quickTypeFilter;

    return matchesSearch && matchesType && matchesStatus && matchesUnsigned && matchesWithoutNumber && matchesDuplicates && matchesClient && matchesQuickClient && matchesRental && matchesManager && matchesQuickType;
  }).sort((left, right) => {
    const leftClient = left.client || clientsById.get(left.clientId || '')?.company || '';
    const rightClient = right.client || clientsById.get(right.clientId || '')?.company || '';
    if (sortKey === 'number') return getDocumentNumber(left).localeCompare(getDocumentNumber(right), 'ru');
    if (sortKey === 'client') return leftClient.localeCompare(rightClient, 'ru');
    if (sortKey === 'status') return getSafeDocumentStatus(left.status).localeCompare(getSafeDocumentStatus(right.status), 'ru');
    if (sortKey === 'createdAt') return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    return getDocumentDate(right).localeCompare(getDocumentDate(left));
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
    withoutNumberOnly,
    duplicatesOnly,
    clientFilter !== 'all',
    rentalFilter !== 'all',
    typeFilter !== 'all',
    statusFilter !== 'all',
    managerFilter !== 'all',
    quickTypeFilter !== 'all',
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
  const wizardTypeMeta = getDocumentRegistryItem(wizardForm.type) || DOCUMENT_WORKSPACE_TYPES[0];
  const wizardClient = wizardForm.clientId ? clientsById.get(wizardForm.clientId) : undefined;
  const wizardRental = wizardForm.rentalId ? rentalsById.get(wizardForm.rentalId) : undefined;
  const wizardEquipment = wizardForm.equipmentId ? equipmentById.get(wizardForm.equipmentId) : undefined;
  const wizardServiceTicket = wizardForm.serviceTicketId ? serviceTicketsById.get(wizardForm.serviceTicketId) : undefined;
  const wizardDelivery = wizardForm.deliveryId ? deliveriesById.get(wizardForm.deliveryId) : undefined;
  const wizardMechanic = wizardForm.mechanicId ? mechanicsById.get(wizardForm.mechanicId) : undefined;
  const wizardServiceVehicle = wizardForm.serviceCarId ? serviceVehiclesById.get(wizardForm.serviceCarId) : undefined;
  const wizardMissingFields = React.useMemo(() => {
    const labels: Record<string, string> = {
      clientId: 'Клиент',
      rentalId: 'Аренда',
      equipmentId: 'Техника',
      serviceTicketId: 'Сервисная заявка',
      deliveryId: 'Доставка',
      mechanicId: 'Механик',
      serviceCarId: 'Служебный автомобиль',
      parentDocumentId: 'Родительский документ',
    };
    return (wizardTypeMeta.requiredFields || [])
      .filter(field => !wizardForm[field as keyof DocumentWizardState])
      .map(field => labels[field] || field);
  }, [wizardForm, wizardTypeMeta]);
  const wizardPreviewRows = React.useMemo(() => ([
    ['Тип', wizardTypeMeta.label],
    ['Дата', new Date().toISOString().slice(0, 10)],
    ['Клиент', wizardClient?.company || wizardRental?.client || '—'],
    ['Техника', wizardEquipment ? getEquipmentLabel(wizardEquipment) : '—'],
    ['Аренда', wizardRental?.id || '—'],
    ['Сервис', wizardServiceTicket?.id || '—'],
    ['Доставка', wizardDelivery?.id || '—'],
    ['Механик', wizardMechanic?.name || '—'],
    ['Служебная машина', wizardServiceVehicle ? [wizardServiceVehicle.make, wizardServiceVehicle.model, wizardServiceVehicle.plateNumber].filter(Boolean).join(' ') : '—'],
    ['Статус', 'Черновик'],
    ['Сумма', wizardRental?.amount || wizardRental?.price ? formatCurrency(Number(wizardRental?.amount || wizardRental?.price)) : '—'],
  ]), [wizardClient, wizardDelivery, wizardEquipment, wizardMechanic, wizardRental, wizardServiceTicket, wizardServiceVehicle, wizardTypeMeta]);

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

  function openCommercialOfferCreate(initial: Partial<CommercialOfferFormState> = {}) {
    const equipmentItem = initial.equipmentId ? equipmentById.get(initial.equipmentId) : undefined;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + Math.max(1, salesSettings.quoteTemplate.validityDays));
    setCommercialOfferForm({
      clientId: '',
      client: '',
      equipmentId: '',
      date: new Date().toISOString().slice(0, 10),
      price: equipmentItem?.salePrice1 ? String(equipmentItem.salePrice1) : '',
      validUntil: validUntil.toISOString().slice(0, 10),
      defaultPaymentTerms: salesSettings.defaultPaymentTerms.paymentText,
      defaultDeliveryTerms: [
        salesSettings.defaultDeliveryTerms.deliveryText,
        `Готовность к отгрузке: ${salesSettings.defaultDeliveryTerms.readinessDays} дн.`,
      ].filter(Boolean).join('\n'),
      warrantyTerms: saleConditionKind(equipmentItem) === 'new'
        ? `${salesSettings.warrantyTerms.warrantyText}\nГарантия: ${salesSettings.warrantyTerms.warrantyMonthsNew} мес.\n${salesSettings.warrantyTerms.exclusionsText}`
        : `${salesSettings.warrantyTerms.warrantyText}\nГарантия: ${salesSettings.warrantyTerms.warrantyMonthsUsed} мес.\n${salesSettings.warrantyTerms.exclusionsText}`,
      kitComment: salesSettings.packageCommentTemplate.text,
      comment: '',
      ...initial,
    });
    setCommercialOfferDialogOpen(true);
  }

  function openDocumentWizard(initial: Partial<DocumentWizardState> = {}) {
    setWizardForm({
      ...EMPTY_WIZARD,
      ...initial,
      type: initial.type || EMPTY_WIZARD.type,
    });
    setWizardStep(1);
    setDocumentWizardOpen(true);
  }

  function applyWizardType(type: DocumentType) {
    setWizardForm(current => ({ ...current, type }));
    setWizardStep(2);
  }

  async function handleGenerateDocument() {
    if (wizardMissingFields.length > 0) {
      toast.error(`Не хватает данных: ${wizardMissingFields.join(', ')}`);
      setWizardStep(4);
      return;
    }
    try {
      const created = await generateDocument.mutateAsync({
        type: wizardForm.type,
        documentType: wizardForm.type,
        date: new Date().toISOString().slice(0, 10),
        status: 'draft',
        clientId: wizardForm.clientId || wizardRental?.clientId || undefined,
        client: wizardClient?.company || wizardRental?.client || '',
        rentalId: wizardForm.rentalId || undefined,
        equipmentId: wizardForm.equipmentId || undefined,
        deliveryId: wizardForm.deliveryId || undefined,
        serviceTicketId: wizardForm.serviceTicketId || undefined,
        mechanicId: wizardForm.mechanicId || undefined,
        serviceCarId: wizardForm.serviceCarId || undefined,
        parentDocumentId: wizardForm.parentDocumentId || undefined,
        objectId: wizardRental?.objectId,
        contractId: wizardRental?.contractId,
        dueDate: wizardForm.dueDate || undefined,
        notes: wizardForm.notes.trim() || undefined,
        comment: wizardForm.notes.trim() || undefined,
        responsibleId: user?.id,
        responsibleName: user?.name || 'Система',
      });
      setDocumentWizardOpen(false);
      setSelectedDocument(created);
      toast.success(`${getDocumentTypeLabel(created)} создан: ${getDocumentNumber(created)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать документ.');
    }
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
      number: '',
      clientId: contractForm.clientId,
      client: contractForm.client.trim(),
      date: contractForm.date,
      status: 'draft',
      signatoryName: contractForm.signatoryName.trim(),
      signatoryBasis: contractForm.signatoryBasis.trim(),
      manager: user?.name || 'Система',
      contentHtml: '',
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

    const created = await createDocument.mutateAsync(payload);
    await updateDocument.mutateAsync({
      id: created.id,
      data: {
        contentHtml: buildContractDraftHtml({
          kind: createContractKind,
          number: getDocumentNumber(created),
          client: contractForm.client.trim(),
          date: contractForm.date,
          signatoryName: contractForm.signatoryName.trim(),
          signatoryBasis: contractForm.signatoryBasis.trim(),
          comment: contractForm.comment.trim() || undefined,
        }),
      },
    });
    setCreateDialogOpen(false);
    toast.success(`${getContractKindLabel(createContractKind)} создан: ${getDocumentNumber(created)}.`);
  }

  async function handleCreateCommercialOffer() {
    if (!commercialOfferForm.equipmentId) {
      toast.error('Выберите технику для КП.');
      return;
    }
    if (!commercialOfferForm.date) {
      toast.error('Укажите дату КП.');
      return;
    }

    const equipmentItem = equipmentById.get(commercialOfferForm.equipmentId);
    const clientName = commercialOfferForm.client.trim() || 'Потенциальный клиент';
    const equipmentSpecs = equipmentItem ? [
      { label: 'Тип', value: equipmentItem.type || '—' },
      { label: 'Год выпуска', value: equipmentItem.year ? String(equipmentItem.year) : '—' },
      { label: 'Наработка', value: equipmentItem.hours ? `${equipmentItem.hours} м/ч` : '—' },
      { label: 'Рабочая высота', value: equipmentItem.workingHeight ? `${equipmentItem.workingHeight} м` : equipmentItem.liftHeight ? `${equipmentItem.liftHeight} м` : '—' },
      { label: 'Грузоподъёмность', value: equipmentItem.loadCapacity ? `${equipmentItem.loadCapacity} кг` : '—' },
      { label: 'Привод', value: equipmentItem.drive || '—' },
    ] : [];
    const payload: Omit<Doc, 'id'> = {
      type: 'commercial_offer',
      documentType: 'commercial_offer',
      number: '',
      clientId: commercialOfferForm.clientId || undefined,
      client: clientName,
      date: commercialOfferForm.date,
      status: 'draft',
      manager: user?.name || 'Система',
      equipmentId: commercialOfferForm.equipmentId,
      equipmentInv: equipmentItem?.inventoryNumber || '',
      equipment: equipmentItem ? getEquipmentLabel(equipmentItem) : '',
      amount: Number(commercialOfferForm.price) || undefined,
      comment: commercialOfferForm.comment.trim() || undefined,
      contentHtml: '',
    };

    const created = await createDocument.mutateAsync(payload);
    await updateDocument.mutateAsync({
      id: created.id,
      data: {
        contentHtml: buildCommercialOfferHtml({
          number: getDocumentNumber(created),
          title: salesSettings.quoteTemplate.title,
          client: clientName,
          date: commercialOfferForm.date,
          validUntil: commercialOfferForm.validUntil || commercialOfferForm.date,
          equipmentLabel: equipmentItem ? `${equipmentItem.manufacturer} ${equipmentItem.model}` : 'Техника',
          inventoryNumber: equipmentItem?.inventoryNumber || '—',
          serialNumber: equipmentItem?.serialNumber || '—',
          equipmentPhoto: equipmentItem?.photo ? absoluteMediaUrl(photoSource(equipmentItem.photo)) : '',
          equipmentSpecs,
          equipmentPackage: 'Комплектация указывается по данным карточки техники и предпродажной проверки.',
          price: commercialOfferForm.price ? formatCurrency(Number(commercialOfferForm.price)) : 'По запросу',
          introText: salesSettings.quoteTemplate.introText,
          footerText: salesSettings.quoteTemplate.footerText,
          showVat: salesSettings.quoteTemplate.showVat,
          showEquipmentPhoto: salesSettings.quoteTemplate.showEquipmentPhoto,
          showEquipmentSpecs: salesSettings.quoteTemplate.showEquipmentSpecs,
          showEquipmentPackage: salesSettings.quoteTemplate.showEquipmentPackage,
          showPaymentTerms: salesSettings.quoteTemplate.showPaymentTerms,
          showDeliveryTerms: salesSettings.quoteTemplate.showDeliveryTerms,
          showWarrantyTerms: salesSettings.quoteTemplate.showWarrantyTerms,
          showPackageComment: salesSettings.quoteTemplate.showPackageComment,
          sectionsOrder: salesSettings.quoteTemplate.sectionsOrder,
          defaultPaymentTerms: commercialOfferForm.defaultPaymentTerms,
          defaultDeliveryTerms: commercialOfferForm.defaultDeliveryTerms,
          warrantyTerms: commercialOfferForm.warrantyTerms,
          kitComment: commercialOfferForm.kitComment,
          comment: commercialOfferForm.comment.trim() || undefined,
        }),
      },
    });
    setCommercialOfferDialogOpen(false);
    toast.success(`Коммерческое предложение создано: ${getDocumentNumber(created)}.`);
  }

  async function handleAssignNumber(doc: Doc) {
    try {
      const updated = await assignDocumentNumber.mutateAsync(doc.id);
      toast.success(`Номер присвоен: ${getDocumentNumber(updated)}.`);
      setSelectedDocument(current => current?.id === updated.id ? updated : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось присвоить номер.');
    }
  }

  function openDocument(doc: Doc) {
    const html = doc.printHtml || doc.generatedContent || doc.contentHtml;
    if (html) {
      openPrintableHtml(html);
      return;
    }
    if (doc.signedScanDataUrl) {
      openDataUrl(doc.signedScanDataUrl);
    }
  }

  function downloadDocument(doc: Doc) {
    const html = doc.printHtml || doc.generatedContent || doc.contentHtml;
    if (html) {
      downloadPrintableHtml(html, `${displayText(doc.number, 'document')}.html`);
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

  async function handleMarkSent(doc: Doc, status: 'sent' | 'pending_signature' = 'sent') {
    try {
      const updated = await markDocumentSent.mutateAsync({ id: doc.id, status });
      setSelectedDocument(current => current?.id === updated.id ? updated : current);
      toast.success(status === 'pending_signature' ? 'Документ отмечен как на подписи.' : 'Документ отмечен как отправленный.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить статус.');
    }
  }

  async function handleMarkSigned(doc: Doc) {
    try {
      const updated = await markDocumentSigned.mutateAsync(doc.id);
      setSelectedDocument(current => current?.id === updated.id ? updated : current);
      toast.success('Документ отмечен как подписанный.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отметить документ подписанным.');
    }
  }

  async function handleDuplicateDocument(doc: Doc) {
    try {
      const duplicated = await duplicateDocument.mutateAsync(doc.id);
      toast.success(`Создан дубль: ${getDocumentNumber(duplicated)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось дублировать документ.');
    }
  }

  async function handleDeleteDocument(doc: Doc) {
    if (!window.confirm(`Удалить документ ${getDocumentNumber(doc) || doc.id}?`)) return;
    try {
      await deleteDocument.mutateAsync(doc.id);
      setSelectedDocument(current => current?.id === doc.id ? null : current);
      toast.success('Документ удалён.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить документ.');
    }
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
            Генерация и контроль договоров, актов, заказ-нарядов и путевых листов
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageDocuments ? (
            <Button onClick={() => openDocumentWizard()}>
              <Plus className="h-4 w-4" />
              Создать документ
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setView('general')}>
            <ClipboardList className="h-4 w-4" />
            Шаблоны
          </Button>
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
          {isAdmin ? (
            <Button variant="secondary">
              <Settings2 className="h-4 w-4" />
              Настройки полей
            </Button>
          ) : null}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              ['Всего документов', registrySummary?.total ?? documents.length],
              ['Черновики', registrySummary?.draft ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'draft').length],
              ['На подписи', registrySummary?.pendingSignature ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'pending_signature').length],
              ['Подписано', registrySummary?.signed ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'signed').length],
              ['Просрочено', registrySummary?.expired ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'expired').length],
              ['За месяц', registrySummary?.currentMonth ?? documents.filter(doc => getDocumentDate(doc).slice(0, 7) === new Date().toISOString().slice(0, 7)).length],
            ].map(([label, value]) => (
              <div key={String(label)} className={`rounded-lg border p-4 ${
                Number(value) > 0 && ['Просрочено'].includes(String(label))
                  ? 'border-amber-300 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
              }`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              ['all', 'Все'],
              ['rental_contract', 'Договоры'],
              ['rental_specification', 'Спецификации'],
              ['transfer_act_to_client', 'Акты передачи'],
              ['return_act_from_client', 'Акты возврата'],
              ['work_order', 'Заказ-наряды'],
              ['trip_ticket', 'Путевые листы'],
              ['unsigned', 'Без подписи'],
              ['overdue', 'Просроченные'],
              ['draft', 'Черновики'],
            ].map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={quickTypeFilter === key ? 'default' : 'secondary'}
                onClick={() => setQuickTypeFilter(key as DocumentQuickFilter)}
                className="shrink-0"
              >
                {label}
              </Button>
            ))}
          </div>

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
              setWithoutNumberOnly(false);
              setDuplicatesOnly(false);
              setClientFilter('all');
              setRentalFilter('all');
              setTypeFilter('all');
              setStatusFilter('all');
              setManagerFilter('all');
              setQuickTypeFilter('all');
              setSortKey('date');
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FilterField label="Поиск" className="md:col-span-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по номеру, клиенту, технике, аренде, сервисной заявке..."
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
              <FilterField label="Нумерация">
                <div className="grid gap-2">
                  <Button
                    type="button"
                    variant={withoutNumberOnly ? 'default' : 'secondary'}
                    onClick={() => setWithoutNumberOnly(value => !value)}
                    className="w-full justify-start"
                  >
                    Без номера
                  </Button>
                  <Button
                    type="button"
                    variant={duplicatesOnly ? 'default' : 'secondary'}
                    onClick={() => setDuplicatesOnly(value => !value)}
                    className="w-full justify-start"
                  >
                    Дубли номеров
                  </Button>
                </div>
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
                    {DOCUMENT_WORKSPACE_TYPES.map(item => (
                      <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>
                    ))}
                    <SelectItem value="contract">Договоры</SelectItem>
                    <SelectItem value="commercial_offer">КП</SelectItem>
                    <SelectItem value="act">Акты</SelectItem>
                    <SelectItem value="upd">УПД</SelectItem>
                    <SelectItem value="invoice">Счета</SelectItem>
                    <SelectItem value="service_act">Сервисные акты</SelectItem>
                    <SelectItem value="work_order">Заказ-наряды</SelectItem>
                    <SelectItem value="other">Прочие</SelectItem>
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
                    <SelectItem value="pending_signature">На подписи</SelectItem>
                    <SelectItem value="signed">Подписан</SelectItem>
                    <SelectItem value="expired">Просрочен</SelectItem>
                    <SelectItem value="cancelled">Отменён</SelectItem>
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
              <FilterField label="Сортировка">
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as typeof sortKey)}>
                  <SelectTrigger className="app-filter-input">
                    <SelectValue placeholder="Сортировка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Дата документа</SelectItem>
                    <SelectItem value="number">Номер</SelectItem>
                    <SelectItem value="client">Клиент</SelectItem>
                    <SelectItem value="status">Статус</SelectItem>
                    <SelectItem value="createdAt">Дата создания</SelectItem>
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
                  <TableHead className="w-10">
                    <input type="checkbox" aria-label="Выбрать все документы" disabled />
                  </TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Номер</TableHead>
                  <TableHead>Дата документа</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Техника / объект</TableHead>
                  <TableHead>Связанная сущность</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Создан</TableHead>
                  <TableHead>Отправлен/подписан</TableHead>
                  <TableHead className="w-[190px]">Действия</TableHead>
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
                  const docNumber = getDocumentNumber(doc);
                  const serviceTicket = getDocumentServiceTicket(doc);
                  const linkedEntity = [
                    rentalId ? `Аренда ${rentalId}` : '',
                    serviceTicket ? `Сервис ${serviceTicket}` : '',
                    doc.deliveryId ? `Доставка ${doc.deliveryId}` : '',
                    doc.parentDocumentId ? `Осн. ${doc.parentDocumentId}` : '',
                  ].filter(Boolean).join(' · ') || '—';
                  return (
                  <TableRow key={doc.id || doc.number || index} className="cursor-pointer" onClick={() => setSelectedDocument(doc)}>
                    <TableCell>
                      <input type="checkbox" aria-label={`Выбрать ${docNumber || doc.id}`} onClick={(event) => event.stopPropagation()} />
                    </TableCell>
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
                        <p className="font-medium text-gray-900 dark:text-white">{docNumber || 'Без номера'}</p>
                        {duplicateDocumentIds.has(doc.id) ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">Дубль номера</p>
                        ) : null}
                        {doc.signedScanFileName ? (
                          <p className="text-xs text-green-600 dark:text-green-400">Скан загружен</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(getDocumentDate(doc))}</TableCell>
                    <TableCell>
                      <p className="text-sm">{displayText(clientName)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{displayText(equipmentInv || equipmentItem?.inventoryNumber)}</p>
                      {equipmentItem ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{displayText(`${equipmentItem.manufacturer || ''} ${equipmentItem.model || ''}`.trim())}</p>
                      ) : null}
                      {doc.objectId ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">Объект {doc.objectId}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{linkedEntity}</p>
                      {rental?.startDate ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(rental.startDate)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>{doc.amount ? formatCurrency(doc.amount) : '—'}</TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{displayText(managerName || doc.createdBy)}</p>
                        {doc.updatedBy ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">изм. {doc.updatedBy}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{getDocumentStatusBadge(getSafeDocumentStatus(doc.status))}</TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{doc.createdAt ? formatDateTime(doc.createdAt) : '—'}</p>
                        {doc.createdBy ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{doc.createdBy}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{doc.sentAt ? formatDateTime(doc.sentAt) : '—'}</p>
                        {doc.signedAt ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">подп. {formatDateTime(doc.signedAt)}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                        {!docNumber && canManageDocuments ? (
                          <button
                            onClick={() => void handleAssignNumber(doc)}
                            className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Присвоить номер"
                          >
                            <FileSignature className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => openDocument(doc)}
                          disabled={!doc.contentHtml && !doc.printHtml && !doc.generatedContent && !doc.signedScanDataUrl}
                          className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={doc.contentHtml || doc.printHtml || doc.generatedContent || doc.signedScanDataUrl ? 'Открыть' : 'Просмотр недоступен'}
                        >
                          <Eye className={`h-4 w-4 ${doc.contentHtml || doc.printHtml || doc.generatedContent || doc.signedScanDataUrl ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`} />
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
                        {canManageDocuments ? (
                          <>
                            <button
                              onClick={() => void handleMarkSent(doc, 'pending_signature')}
                              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Отметить на подписи"
                            >
                              <Send className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                            </button>
                            <button
                              onClick={() => void handleMarkSigned(doc)}
                              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Отметить подписанным"
                            >
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            </button>
                            <button
                              onClick={() => void handleDuplicateDocument(doc)}
                              className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Дублировать"
                            >
                              <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                            </button>
                            {isAdmin ? (
                              <button
                                onClick={() => void handleDeleteDocument(doc)}
                                className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                                title="Удалить"
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </button>
                            ) : null}
                          </>
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
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {canManageDocuments ? (
                    <Button onClick={() => openDocumentWizard()}>
                      <Plus className="h-4 w-4" />
                      Создать документ
                    </Button>
                  ) : null}
                  {activeFilterCount > 0 ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setUnsignedOnly(false);
                        setWithoutNumberOnly(false);
                        setDuplicatesOnly(false);
                        setClientFilter('all');
                        setRentalFilter('all');
                        setTypeFilter('all');
                        setStatusFilter('all');
                        setManagerFilter('all');
                        setQuickTypeFilter('all');
                      }}
                    >
                      Сбросить фильтры
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {filteredDocuments.length > 0 && (
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <p>Показано {filteredDocuments.length} из {documents.length} документов</p>
            </div>
          )}

          <Dialog open={documentWizardOpen} onOpenChange={setDocumentWizardOpen}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5" />
                  Создать документ
                </DialogTitle>
                <DialogDescription>
                  Единый мастер создаёт черновик с номером, snapshot и печатной формой.
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[64vh] space-y-5 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6].map(step => (
                    <Button
                      key={step}
                      type="button"
                      variant={wizardStep === step ? 'default' : 'secondary'}
                      onClick={() => setWizardStep(step)}
                      className="h-8 px-3 text-xs"
                    >
                      Шаг {step}
                    </Button>
                  ))}
                </div>

                {wizardStep === 1 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {DOCUMENT_WORKSPACE_TYPES.map(item => {
                      const Icon = DOCUMENT_ICON_MAP[item.icon as keyof typeof DOCUMENT_ICON_MAP] || FileSignature;
                      return (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => applyWizardType(item.type)}
                          className={`rounded-lg border p-4 text-left transition hover:border-slate-400 dark:hover:border-gray-500 ${
                            wizardForm.type === item.type
                              ? 'border-lime-300 bg-lime-50 dark:border-lime-800 dark:bg-lime-950/20'
                              : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Icon className="mt-0.5 h-5 w-5 text-slate-600 dark:text-gray-300" />
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.purpose}</p>
                              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Префикс {item.numberPrefix}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {wizardStep === 2 ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Клиент</div>
                      <Select value={wizardForm.clientId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, clientId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите клиента" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбран</SelectItem>
                          {(clients as Client[]).map(client => <SelectItem key={client.id} value={client.id}>{client.company}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Аренда</div>
                      <Select value={wizardForm.rentalId || 'none'} onValueChange={(value) => {
                        const rental = value === 'none' ? undefined : rentalsById.get(value);
                        setWizardForm(current => ({ ...current, rentalId: value === 'none' ? '' : value, clientId: current.clientId || rental?.clientId || '' }));
                      }}>
                        <SelectTrigger><SelectValue placeholder="Выберите аренду" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрана</SelectItem>
                          {(rentals as Rental[]).map(rental => <SelectItem key={rental.id} value={rental.id}>{getRentalLabel(rental)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Техника</div>
                      <Select value={wizardForm.equipmentId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, equipmentId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите технику" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрана</SelectItem>
                          {(equipment as Equipment[]).map(item => <SelectItem key={item.id} value={item.id}>{getEquipmentLabel(item)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Сервисная заявка</div>
                      <Select value={wizardForm.serviceTicketId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, serviceTicketId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите заявку" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрана</SelectItem>
                          {(serviceTickets as ServiceTicket[]).map(ticket => <SelectItem key={ticket.id} value={ticket.id}>{ticket.id} · {ticket.reason || ticket.description || 'Сервис'}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Доставка</div>
                      <Select value={wizardForm.deliveryId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, deliveryId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите доставку" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрана</SelectItem>
                          {(deliveries as Delivery[]).map(delivery => <SelectItem key={delivery.id} value={delivery.id}>{delivery.id} · {delivery.status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Механик</div>
                      <Select value={wizardForm.mechanicId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, mechanicId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите механика" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбран</SelectItem>
                          {mechanicList.map(mechanic => <SelectItem key={mechanic.id} value={mechanic.id}>{mechanic.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Служебная машина</div>
                      <Select value={wizardForm.serviceCarId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, serviceCarId: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите машину" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрана</SelectItem>
                          {(serviceVehicles as ServiceVehicle[]).map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>{[vehicle.make, vehicle.model, vehicle.plateNumber].filter(Boolean).join(' ')}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Срок подписи</div>
                      <Input type="date" value={wizardForm.dueDate} onChange={(event) => setWizardForm(current => ({ ...current, dueDate: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {wizardStep === 3 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {wizardPreviewRows.slice(2).map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{value}</p>
                      </div>
                    ))}
                    <div className="space-y-2 sm:col-span-2">
                      <div className="text-sm font-medium text-foreground">Комментарий / примечания</div>
                      <Textarea rows={3} value={wizardForm.notes} onChange={(event) => setWizardForm(current => ({ ...current, notes: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {wizardStep === 4 ? (
                  <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <p className="font-medium text-gray-900 dark:text-white">Проверка обязательных полей</p>
                    {wizardMissingFields.length > 0 ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                        {wizardMissingFields.map(item => <li key={item}>{item}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-green-700 dark:text-green-300">Все обязательные данные заполнены.</p>
                    )}
                  </div>
                ) : null}

                {wizardStep >= 5 ? (
                  <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="font-medium text-gray-900 dark:text-white">Предпросмотр</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {wizardPreviewRows.map(([label, value]) => (
                        <div key={label} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
                          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="sticky bottom-0 bg-white pt-3 dark:bg-gray-900">
                <Button variant="secondary" onClick={() => setDocumentWizardOpen(false)}>Отмена</Button>
                {wizardStep > 1 ? <Button variant="secondary" onClick={() => setWizardStep(step => Math.max(1, step - 1))}>Назад</Button> : null}
                {wizardStep < 5 ? (
                  <Button onClick={() => setWizardStep(step => Math.min(5, step + 1))}>Далее</Button>
                ) : (
                  <Button onClick={() => void handleGenerateDocument()} disabled={generateDocument.isPending || wizardMissingFields.length > 0}>
                    Создать черновик
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

          <Dialog open={commercialOfferDialogOpen} onOpenChange={setCommercialOfferDialogOpen}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5" />
                  Коммерческое предложение
                </DialogTitle>
                <DialogDescription>
                  Будет создан документ типа “Коммерческое предложение”. Минимальная цена в КП не выводится.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Клиент</div>
                  <ClientCombobox
                    clients={clients as Client[]}
                    value={commercialOfferForm.client}
                    valueId={commercialOfferForm.clientId}
                    onChange={(value) => setCommercialOfferForm(current => ({ ...current, client: value }))}
                    onClientSelect={(client) => setCommercialOfferForm(current => ({
                      ...current,
                      clientId: client?.id ?? '',
                      client: client?.company ?? '',
                    }))}
                    placeholder="Выберите клиента или оставьте потенциального"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Техника</div>
                    <Select
                      value={commercialOfferForm.equipmentId || 'none'}
                      onValueChange={(value) => {
                        const equipmentItem = value === 'none' ? undefined : equipmentById.get(value);
                        setCommercialOfferForm(current => ({
                          ...current,
                          equipmentId: value === 'none' ? '' : value,
                          price: equipmentItem?.salePrice1 ? String(equipmentItem.salePrice1) : current.price,
                          kitComment: salesSettings.packageCommentTemplate.text,
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите технику" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без техники</SelectItem>
                        {(equipment as Equipment[]).map(item => (
                          <SelectItem key={item.id} value={item.id}>{getEquipmentLabel(item)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Цена продажи</div>
                    <Input
                      type="number"
                      min="0"
                      value={commercialOfferForm.price}
                      onChange={(event) => setCommercialOfferForm(current => ({ ...current, price: event.target.value }))}
                      placeholder="Цена для клиента"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Дата КП</div>
                    <Input
                      type="date"
                      value={commercialOfferForm.date}
                      onChange={(event) => setCommercialOfferForm(current => ({ ...current, date: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Срок действия</div>
                    <Input
                      type="date"
                      value={commercialOfferForm.validUntil}
                      onChange={(event) => setCommercialOfferForm(current => ({ ...current, validUntil: event.target.value }))}
                    />
                  </div>
                </div>

                {[
                  ['defaultPaymentTerms', 'Условия оплаты'],
                  ['defaultDeliveryTerms', 'Условия доставки'],
                  ['warrantyTerms', 'Гарантийные условия'],
                  ['kitComment', 'Комплектация'],
                  ['comment', 'Комментарий'],
                ].map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <div className="text-sm font-medium text-foreground">{label}</div>
                    <Textarea
                      rows={key === 'comment' ? 2 : 3}
                      value={commercialOfferForm[key as keyof CommercialOfferFormState]}
                      onChange={(event) => setCommercialOfferForm(current => ({ ...current, [key]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setCommercialOfferDialogOpen(false)}>
                  Отмена
                </Button>
                <Button
                  onClick={() => void handleCreateCommercialOffer()}
                  className="bg-lime-300 text-slate-950 hover:bg-lime-200"
                  disabled={createDocument.isPending || updateDocument.isPending}
                >
                  Создать КП
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={Boolean(selectedDocument)} onOpenChange={(open) => !open && setSelectedDocument(null)}>
            <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
              {selectedDocument ? (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileSignature className="h-5 w-5" />
                      {getDocumentNumber(selectedDocument) || 'Документ без номера'}
                    </DialogTitle>
                    <DialogDescription>
                      {getDocumentTypeLabel(selectedDocument)} · {formatDate(getDocumentDate(selectedDocument))}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        ['Статус', getDocumentStatusLabel(selectedDocument.status)],
                        ['Клиент', displayText(selectedDocument.client || clientsById.get(selectedDocument.clientId || '')?.company)],
                        ['Аренда', displayText(getDocumentRentalId(selectedDocument))],
                        ['Техника', displayText(getDocumentEquipmentInv(selectedDocument) || selectedDocument.equipmentId)],
                        ['Сервисная заявка', displayText(getDocumentServiceTicket(selectedDocument))],
                        ['Сумма', selectedDocument.amount ? formatCurrency(selectedDocument.amount) : '—'],
                        ['Создал', displayText(selectedDocument.createdBy)],
                        ['Изменил', displayText(selectedDocument.updatedBy)],
                        ['Создан', selectedDocument.createdAt ? formatDateTime(selectedDocument.createdAt) : '—'],
                        ['Подписан', selectedDocument.signedAt ? formatDateTime(selectedDocument.signedAt) : '—'],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{value}</p>
                        </div>
                      ))}
                    </div>

                    {(selectedDocument.fileUrl || selectedDocument.fileName || selectedDocument.signedScanFileName) ? (
                      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Файл</p>
                        <p className="mt-1 text-sm text-gray-900 dark:text-white">
                          {selectedDocument.fileName || selectedDocument.signedScanFileName || selectedDocument.fileUrl}
                        </p>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium dark:border-gray-700">
                        История изменений
                      </div>
                      <div className="max-h-64 overflow-y-auto p-3">
                        {selectedDocument.history?.length ? (
                          <div className="space-y-3">
                            {[...selectedDocument.history].reverse().map(entry => (
                              <div key={entry.id} className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-medium text-gray-900 dark:text-white">
                                    {entry.action === 'created' ? 'Создание' : entry.action === 'number_assigned' ? 'Номер присвоен' : entry.action === 'number_changed' ? 'Номер изменён' : 'Изменение'}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(entry.createdAt)}</span>
                                </div>
                                {entry.field ? (
                                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {entry.field}: {displayText(entry.oldValue, '—')} → {displayText(entry.newValue, '—')}
                                  </p>
                                ) : null}
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{displayText(entry.createdBy)}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400">История пока не зафиксирована.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    {!getDocumentNumber(selectedDocument) && canManageDocuments ? (
                      <Button variant="secondary" onClick={() => void handleAssignNumber(selectedDocument)}>
                        Присвоить номер
                      </Button>
                    ) : null}
                    {canManageDocuments ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void updateDocument.mutateAsync({
                            id: selectedDocument.id,
                            data: { status: selectedDocument.status === 'signed' ? 'draft' : 'sent' },
                          }).then(updated => {
                            setSelectedDocument(updated);
                            toast.success('Статус документа обновлён.');
                          });
                        }}
                      >
                        Изменить статус
                      </Button>
                    ) : null}
                    <Button variant="secondary" onClick={() => setSelectedDocument(null)}>Закрыть</Button>
                  </DialogFooter>
                </>
              ) : null}
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
