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
import { ClientCombobox, clientLabel } from '../components/ui/ClientCombobox';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileSignature,
  FileText,
  Layers3,
  MoreHorizontal,
  Plus,
  Printer,
  Route,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wrench,
  UserRound,
} from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../components/ui/filter-dialog';
import { usePaginatedClients } from '../hooks/useClients';
import {
  useAssignDocumentNumber,
  useCreateDocument,
  useDeleteDocument,
  useDocumentGanttReferences,
  useDocumentReferences,
  useDuplicateDocument,
  useDocumentRegistrySummary,
  usePaginatedDocuments,
  useGenerateDocument,
  useMarkDocumentSent,
  useMarkDocumentSigned,
  useUpdateDocument,
} from '../hooks/useDocuments';
import { usePaginatedEquipment } from '../hooks/useEquipment';
import { usePaginatedRentals } from '../hooks/useRentals';
import { usePaginatedServiceTickets } from '../hooks/useServiceTickets';
import { buildDocumentControl, getDocumentControlStatusLabel, isUnsignedDocument } from '../lib/documentControl.js';
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
import { serviceVehiclesService } from '../services/service-vehicles.service';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { normalizeUserRole } from '../lib/userStorage';
import { useServerPagination } from '../hooks/useServerPagination';
import { PaginationControls } from '../components/common/PaginationControls';
import { usePaginatedDeliveries } from '../hooks/useDeliveries';
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
  specificationId: string;
  dueDate: string;
  signerName: string;
  signerPosition: string;
  signerBasis: string;
  signerBasisNumber: string;
  signerBasisDate: string;
  clientLegalName: string;
  clientInn: string;
  clientKpp: string;
  clientOgrn: string;
  clientLegalAddress: string;
  clientPostalAddress: string;
  clientBankName: string;
  clientBankBik: string;
  clientBankAccount: string;
  clientCorrAccount: string;
  rentalStartDate: string;
  rentalEndDate: string;
  dailyRate: string;
  quantityDays: string;
  amount: string;
  transferDate: string;
  equipmentCondition: string;
  completeness: string;
  companyRepresentative: string;
  clientRepresentative: string;
  returnDate: string;
  returnCondition: string;
  damages: string;
  missingItems: string;
  serviceRequired: string;
  works: string;
  parts: string;
  laborHours: string;
  repairResult: string;
  tripDate: string;
  routeFrom: string;
  routeTo: string;
  purpose: string;
  startMileage: string;
  endMileage: string;
  fuelIssued: string;
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
  specificationId: '',
  dueDate: '',
  signerName: '',
  signerPosition: '',
  signerBasis: '',
  signerBasisNumber: '',
  signerBasisDate: '',
  clientLegalName: '',
  clientInn: '',
  clientKpp: '',
  clientOgrn: '',
  clientLegalAddress: '',
  clientPostalAddress: '',
  clientBankName: '',
  clientBankBik: '',
  clientBankAccount: '',
  clientCorrAccount: '',
  rentalStartDate: '',
  rentalEndDate: '',
  dailyRate: '',
  quantityDays: '',
  amount: '',
  transferDate: '',
  equipmentCondition: '',
  completeness: '',
  companyRepresentative: '',
  clientRepresentative: '',
  returnDate: '',
  returnCondition: '',
  damages: '',
  missingItems: '',
  serviceRequired: '',
  works: '',
  parts: '',
  laborHours: '',
  repairResult: '',
  tripDate: '',
  routeFrom: '',
  routeTo: '',
  purpose: '',
  startMileage: '',
  endMileage: '',
  fuelIssued: '',
  notes: '',
};

function clientField(client: Client | null | undefined, keys: string[]): string {
  const record = client as unknown as Record<string, unknown> | null | undefined;
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function fillWizardClientFields(current: DocumentWizardState, client: Client | null): DocumentWizardState {
  if (!client) {
    return { ...current, clientId: '' };
  }
  return {
    ...current,
    clientId: client.id,
    clientLegalName: current.clientLegalName || clientField(client, ['legalName', 'fullName', 'company']),
    clientInn: current.clientInn || clientField(client, ['inn', 'taxId']),
    clientKpp: current.clientKpp || clientField(client, ['kpp']),
    clientOgrn: current.clientOgrn || clientField(client, ['ogrn']),
    clientLegalAddress: current.clientLegalAddress || clientField(client, ['legalAddress', 'address']),
    clientPostalAddress: current.clientPostalAddress || clientField(client, ['postalAddress', 'mailingAddress', 'actualAddress', 'address']),
    clientBankName: current.clientBankName || clientField(client, ['bankName', 'bank']),
    clientBankBik: current.clientBankBik || clientField(client, ['bankBik', 'bik']),
    clientBankAccount: current.clientBankAccount || clientField(client, ['bankAccount', 'settlementAccount', 'account']),
    clientCorrAccount: current.clientCorrAccount || clientField(client, ['corrAccount', 'correspondentAccount', 'bankCorrAccount']),
  };
}

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

function getDocumentTypeVisual(doc: Partial<Doc> | null | undefined) {
  const type = doc?.type;
  if (type === 'rental_contract' || type === 'contract') {
    return { Icon: FileSignature, className: 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/25' };
  }
  if (type === 'rental_specification') {
    return { Icon: ClipboardList, className: 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25' };
  }
  if (type === 'transfer_act_to_client') {
    return { Icon: Send, className: 'bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/25' };
  }
  if (type === 'return_act_from_client') {
    return { Icon: Printer, className: 'bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25' };
  }
  if (type === 'trip_ticket') {
    return { Icon: Route, className: 'bg-cyan-100 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-400/25' };
  }
  if (type === 'work_order' || type === 'service_act') {
    return { Icon: Wrench, className: 'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25' };
  }
  return { Icon: FileText, className: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/20 dark:text-slate-300 dark:ring-white/10' };
}

function getDocumentStatusPill(status: unknown) {
  const safe = getSafeDocumentStatus(status);
  const map: Record<DocumentStatus, { label: string; className: string }> = {
    draft: { label: 'Черновик', className: 'bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-400/12 dark:text-sky-200 dark:ring-sky-300/20' },
    signed: { label: 'Подписано', className: 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/12 dark:text-emerald-200 dark:ring-emerald-300/25' },
    sent: { label: 'Отправлено', className: 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-400/12 dark:text-blue-200 dark:ring-blue-300/20' },
    pending_signature: { label: 'На подписи', className: 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-300/15 dark:text-amber-100 dark:ring-amber-200/25' },
    expired: { label: 'Просрочено', className: 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-400/15 dark:text-rose-100 dark:ring-rose-300/25' },
    cancelled: { label: 'Отменено', className: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/12 dark:text-slate-300 dark:ring-white/10' },
  };
  const meta = map[safe];
  return (
    <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ${meta.className}`}>
      {meta.label}
    </span>
  );
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

function getGanttReferenceLabel(entry: GanttRentalData | undefined) {
  if (!entry) return '';
  const rentalId = getRentalSourceId(entry) || entry.id;
  const start = entry.startDate ? formatDate(entry.startDate) : '';
  const equipment = entry.equipmentInv || entry.equipmentId || '';
  return [rentalId, entry.client, equipment, start].filter(Boolean).join(' · ');
}

function getEquipmentLabel(item: Equipment | undefined) {
  if (!item) return '';
  return [item.inventoryNumber, item.manufacturer, item.model].filter(Boolean).join(' · ');
}

function getRentalEquipmentInventory(rental: Rental | undefined) {
  if (!rental) return '';
  return Array.isArray(rental.equipment) ? rental.equipment[0] || '' : '';
}

function countRentalDays(startDate: string | undefined, endDate: string | undefined) {
  if (!startDate || !endDate) return '';
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  return String(Math.floor((end - start) / 86400000) + 1);
}

function rentalDailyRate(rental: Rental | undefined) {
  if (!rental) return '';
  return displayText((rental as unknown as Record<string, unknown>).dailyRate || rental.rate, '');
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
  const documentPagination = useServerPagination<{
    type: string;
    status: string;
    signature: string;
    clientId: string;
    rentalId: string;
  }>({
    initialSortBy: 'date',
    initialSortDir: 'desc',
    initialFilters: { type: 'all', status: 'all', signature: 'all', clientId: 'all', rentalId: 'all' },
    storageKey: 'documents',
  });
  const documentsQuery = usePaginatedDocuments({
    page: documentPagination.page,
    pageSize: documentPagination.pageSize,
    search: documentPagination.debouncedSearch,
    sortBy: documentPagination.sortBy,
    sortDir: documentPagination.sortDir,
    filters: documentPagination.filters,
  });
  const { data: registrySummary } = useDocumentRegistrySummary();
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [commercialOfferDialogOpen, setCommercialOfferDialogOpen] = React.useState(false);
  const [documentWizardOpen, setDocumentWizardOpen] = React.useState(false);
  const [rentalReferenceSearch, setRentalReferenceSearch] = React.useState('');
  const debouncedRentalReferenceSearch = React.useDeferredValue(rentalReferenceSearch);
  const [wizardStep, setWizardStep] = React.useState(1);
  const [wizardForm, setWizardForm] = React.useState<DocumentWizardState>(EMPTY_WIZARD);
  const referenceLoadEnabled = createDialogOpen || commercialOfferDialogOpen || documentWizardOpen;
  const { data: clientsReference } = usePaginatedClients({ page: 1, pageSize: 100, sortBy: 'company', sortDir: 'asc' }, { enabled: referenceLoadEnabled });
  const { data: rentalsReference } = usePaginatedRentals({ page: 1, pageSize: 100, sortBy: 'startDate', sortDir: 'desc' }, { enabled: referenceLoadEnabled });
  const { data: equipmentReference } = usePaginatedEquipment({ page: 1, pageSize: 100, sortBy: 'inventoryNumber', sortDir: 'asc' }, { enabled: referenceLoadEnabled });
  const { data: serviceTicketsReference } = usePaginatedServiceTickets({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDir: 'desc' }, { enabled: referenceLoadEnabled });
  const { data: deliveriesReference } = usePaginatedDeliveries({ page: 1, pageSize: 100, sortBy: 'date', sortDir: 'desc' }, { enabled: referenceLoadEnabled, scope: 'documents' });
  const clients = clientsReference?.items ?? [];
  const rentals = rentalsReference?.items ?? [];
  const equipment = equipmentReference?.items ?? [];
  const serviceTickets = serviceTicketsReference?.items ?? [];
  const deliveries = deliveriesReference?.items ?? [];
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

  const search = documentPagination.search;
  const setSearch = documentPagination.setSearch;
  const [unsignedOnly, setUnsignedOnly] = React.useState(false);
  const [withoutNumberOnly, setWithoutNumberOnly] = React.useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = React.useState(false);
  const [periodFrom, setPeriodFrom] = React.useState('');
  const [periodTo, setPeriodTo] = React.useState('');
  const clientFilter = documentPagination.filters.clientId;
  const rentalFilter = documentPagination.filters.rentalId;
  const typeFilter = documentPagination.filters.type;
  const statusFilter = documentPagination.filters.status;
  const signatureFilter = documentPagination.filters.signature;
  const setDocumentFilters = documentPagination.setFilters;
  const setClientFilter = React.useCallback((value: string) => setDocumentFilters({ clientId: value }), [setDocumentFilters]);
  const setRentalFilter = React.useCallback((value: string) => setDocumentFilters({ rentalId: value }), [setDocumentFilters]);
  const setTypeFilter = React.useCallback((value: string) => setDocumentFilters({ type: value }), [setDocumentFilters]);
  const setStatusFilter = React.useCallback((value: string) => setDocumentFilters({ status: value }), [setDocumentFilters]);
  const setSignatureFilter = React.useCallback((value: string) => setDocumentFilters({ signature: value }), [setDocumentFilters]);
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
  const ganttReferencesQuery = useDocumentGanttReferences({
    limit: 100,
    search: debouncedRentalReferenceSearch.trim() || undefined,
    clientId: wizardForm.clientId || contractForm.clientId || commercialOfferForm.clientId || undefined,
    rentalId: wizardForm.rentalId || contractForm.rentalId || undefined,
    equipmentId: wizardForm.equipmentId || contractForm.equipmentId || commercialOfferForm.equipmentId || undefined,
  }, { enabled: referenceLoadEnabled });
  const ganttRentals = ganttReferencesQuery.data?.items ?? [];

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const signedScanInputRef = React.useRef<HTMLInputElement | null>(null);
  const appliedQuickActionRef = React.useRef('');
  const [signedScanTargetDoc, setSignedScanTargetDoc] = React.useState<Doc | null>(null);
  const documents = documentsQuery.data?.items ?? [];
  const referenceDocumentIds = React.useMemo(() => [
    wizardForm.parentDocumentId,
    wizardForm.specificationId,
    selectedDocument?.parentDocumentId || '',
    selectedDocument?.specificationId || '',
  ].filter(Boolean).join(','), [
    selectedDocument?.parentDocumentId,
    selectedDocument?.specificationId,
    wizardForm.parentDocumentId,
    wizardForm.specificationId,
  ]);
  const documentReferencesQuery = useDocumentReferences({
    page: 1,
    pageSize: 100,
    types: 'rental_contract,rental_specification',
    ids: referenceDocumentIds || undefined,
    filters: {
      clientId: wizardForm.clientId || undefined,
      rentalId: wizardForm.rentalId || undefined,
      parentDocumentId: wizardForm.parentDocumentId || undefined,
    },
  }, { enabled: documentWizardOpen });
  const referenceDocuments = documentWizardOpen
    ? (documentReferencesQuery.data?.items ?? [])
    : documents;
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
      if (entry.id && !map.has(entry.id)) map.set(entry.id, entry);
    });
    return map;
  }, [ganttRentals]);
  const rentalReferenceOptions = React.useMemo(() => {
    const options = new Map<string, { id: string; label: string }>();
    (rentals as Rental[]).forEach(rental => {
      if (rental.id) options.set(rental.id, { id: rental.id, label: getRentalLabel(rental) });
    });
    (ganttRentals as GanttRentalData[]).forEach(entry => {
      const id = getRentalSourceId(entry) || entry.id;
      if (id && !options.has(id)) options.set(id, { id, label: getGanttReferenceLabel(entry) });
    });
    return Array.from(options.values());
  }, [ganttRentals, rentals]);
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
  const relatedRentalOptions = React.useMemo(() => {
    if (!contractForm.clientId && !contractForm.client) return rentalReferenceOptions;
    return rentalReferenceOptions.filter(option => {
      const rental = rentalsById.get(option.id);
      const gantt = ganttByRentalId.get(option.id);
      return rental?.clientId === contractForm.clientId
        || rental?.client === contractForm.client
        || gantt?.clientId === contractForm.clientId
        || gantt?.client === contractForm.client;
    });
  }, [contractForm.client, contractForm.clientId, ganttByRentalId, rentalReferenceOptions, rentalsById]);
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
    referenceDocuments.forEach(doc => {
      if (displayText(doc.manager, '')) names.add(displayText(doc.manager, ''));
      const rentalId = getDocumentRentalId(doc);
      const rental = rentalId ? rentalsById.get(rentalId) : undefined;
      if (displayText(rental?.manager, '')) names.add(displayText(rental?.manager, ''));
    });
    (rentals as Rental[]).forEach(rental => {
      if (displayText(rental.manager, '')) names.add(displayText(rental.manager, ''));
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [referenceDocuments, rentals, rentalsById]);

  const duplicateDocumentIds = React.useMemo(() => {
    const counts = new Map<string, number>();
    referenceDocuments.forEach(doc => {
      const number = getDocumentNumber(doc).toLowerCase();
      if (!number) return;
      const year = getDocumentDate(doc).slice(0, 4);
      const key = `${doc.type}:${year}:${number}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicates = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
    return new Set(referenceDocuments
      .filter(doc => duplicates.has(`${doc.type}:${getDocumentDate(doc).slice(0, 4)}:${getDocumentNumber(doc).toLowerCase()}`))
      .map(doc => doc.id));
  }, [referenceDocuments]);

  React.useEffect(() => {
    const requestedSignature = String(searchParams.get('signature') || '').toLowerCase();
    const requestedQuickFilter = String(searchParams.get('quickFilter') || searchParams.get('filter') || '').toLowerCase();
    if (requestedSignature === 'unsigned' || requestedQuickFilter === 'unsigned') {
      setView('general');
      setQuickTypeFilter('unsigned');
      setSignatureFilter('unsigned');
      setStatusFilter('all');
      setTypeFilter('all');
    }
  }, [searchParams, setSignatureFilter, setStatusFilter, setTypeFilter]);

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

    const requestedType = String(quickActionContext.type || '').toLowerCase();
    const wizardDocumentTypes: DocumentType[] = [
      'rental_contract',
      'rental_specification',
      'transfer_act_to_client',
      'return_act_from_client',
    ];
    if (['commercial_offer', 'quote', 'kp', 'кп'].includes(requestedType)) {
      openCommercialOfferCreate({
        clientId: quickActionClient?.id || quickActionRental?.clientId || quickActionContext.clientId,
        client: quickActionClient?.company || quickActionRental?.client || quickActionContext.clientName,
        equipmentId: quickActionEquipment?.id || quickActionContext.equipmentId,
      });
    } else if (wizardDocumentTypes.includes(requestedType as DocumentType)) {
      const rentalEndDate = quickActionContext.rentalEndDate
        || quickActionRental?.plannedReturnDate
        || (quickActionRental as unknown as Record<string, string | undefined> | undefined)?.endDate
        || '';
      openDocumentWizard({
        type: requestedType as DocumentType,
        clientId: quickActionClient?.id || quickActionRental?.clientId || quickActionContext.clientId,
        rentalId: quickActionRental?.id || quickActionContext.rentalId,
        equipmentId: quickActionEquipment?.id || quickActionContext.equipmentId,
        parentDocumentId: quickActionContext.parentDocumentId,
        specificationId: quickActionContext.specificationId,
        rentalStartDate: quickActionContext.rentalStartDate || quickActionRental?.startDate || '',
        rentalEndDate,
        dailyRate: quickActionContext.dailyRate || rentalDailyRate(quickActionRental),
        quantityDays: quickActionContext.quantityDays || countRentalDays(quickActionRental?.startDate, rentalEndDate),
        amount: quickActionContext.amount || String((quickActionRental as unknown as Record<string, unknown> | undefined)?.amount || quickActionRental?.price || ''),
        transferDate: quickActionContext.transferDate || quickActionRental?.startDate || new Date().toISOString().slice(0, 10),
        returnDate: quickActionContext.returnDate || quickActionRental?.actualReturnDate || quickActionRental?.plannedReturnDate || new Date().toISOString().slice(0, 10),
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
    const documentDate = getDocumentDate(doc).slice(0, 10);
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
    const docIsUnsigned = isUnsignedDocument(doc);
    const matchesUnsigned = (!unsignedOnly && signatureFilter !== 'unsigned') || docIsUnsigned;
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
    const matchesPeriod = (!periodFrom && !periodTo)
      || (Boolean(documentDate)
        && (!periodFrom || documentDate >= periodFrom)
        && (!periodTo || documentDate <= periodTo));
    const isOverdue = safeStatus === 'expired' || Boolean(doc.dueDate && doc.dueDate < new Date().toISOString().slice(0, 10) && docIsUnsigned);
    const matchesQuickType = quickTypeFilter === 'all'
      || (quickTypeFilter === 'unsigned' && docIsUnsigned)
      || (quickTypeFilter === 'overdue' && isOverdue)
      || (quickTypeFilter === 'draft' && safeStatus === 'draft')
      || doc.type === quickTypeFilter;

    return matchesSearch && matchesType && matchesStatus && matchesUnsigned && matchesWithoutNumber && matchesDuplicates && matchesClient && matchesQuickClient && matchesRental && matchesManager && matchesPeriod && matchesQuickType;
  }).sort((left, right) => {
    const leftClient = left.client || clientsById.get(left.clientId || '')?.company || '';
    const rightClient = right.client || clientsById.get(right.clientId || '')?.company || '';
    if (sortKey === 'number') return getDocumentNumber(left).localeCompare(getDocumentNumber(right), 'ru');
    if (sortKey === 'client') return leftClient.localeCompare(rightClient, 'ru');
    if (sortKey === 'status') return getSafeDocumentStatus(left.status).localeCompare(getSafeDocumentStatus(right.status), 'ru');
    if (sortKey === 'createdAt') return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    return getDocumentDate(right).localeCompare(getDocumentDate(left));
  });
  const documentRows = filteredDocuments.map((doc, index) => {
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
    const equipmentModel = equipmentItem
      ? displayText(`${equipmentItem.manufacturer || ''} ${equipmentItem.model || ''}`.trim())
      : '';

    return {
      doc,
      index,
      key: doc.id || doc.number || index,
      rentalId,
      equipmentInv,
      equipmentItem,
      clientName,
      managerName,
      docNumber,
      linkedEntity,
      equipmentLabel: displayText(equipmentInv || equipmentItem?.inventoryNumber),
      equipmentModel,
      documentDateLabel: formatDate(getDocumentDate(doc)),
      amountLabel: doc.amount ? formatCurrency(doc.amount) : '—',
      createdLabel: doc.createdAt ? formatDateTime(doc.createdAt) : '—',
      sentLabel: doc.sentAt ? formatDateTime(doc.sentAt) : '—',
      signedLabel: doc.signedAt ? formatDateTime(doc.signedAt) : '',
      isDuplicate: duplicateDocumentIds.has(doc.id),
      canOpen: Boolean(doc.contentHtml || doc.printHtml || doc.generatedContent || doc.signedScanDataUrl),
      canDownload: Boolean(doc.contentHtml || doc.signedScanDataUrl),
    };
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
    signatureFilter !== 'all',
    managerFilter !== 'all',
    quickTypeFilter !== 'all',
    periodFrom !== '',
    periodTo !== '',
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
    () => nextContractNumber(referenceDocuments, createContractKind, contractForm.date),
    [createContractKind, contractForm.date, referenceDocuments],
  );
  const wizardTypeMeta = getDocumentRegistryItem(wizardForm.type) || DOCUMENT_WORKSPACE_TYPES[0];
  const wizardRental = wizardForm.rentalId ? rentalsById.get(wizardForm.rentalId) : undefined;
  const wizardGanttRental = wizardForm.rentalId ? ganttByRentalId.get(wizardForm.rentalId) : undefined;
  const wizardParentDocument = wizardForm.parentDocumentId ? referenceDocuments.find(doc => doc.id === wizardForm.parentDocumentId) : undefined;
  const wizardSpecification = wizardForm.specificationId ? referenceDocuments.find(doc => doc.id === wizardForm.specificationId) : undefined;
  const wizardResolvedClientId = wizardForm.clientId || wizardParentDocument?.clientId || wizardSpecification?.clientId || wizardRental?.clientId || wizardGanttRental?.clientId || '';
  const wizardClient = wizardResolvedClientId ? clientsById.get(wizardResolvedClientId) : undefined;
  const wizardEquipment = wizardForm.equipmentId ? equipmentById.get(wizardForm.equipmentId) : undefined;
  const wizardServiceTicket = wizardForm.serviceTicketId ? serviceTicketsById.get(wizardForm.serviceTicketId) : undefined;
  const wizardDelivery = wizardForm.deliveryId ? deliveriesById.get(wizardForm.deliveryId) : undefined;
  const wizardMechanic = wizardForm.mechanicId ? mechanicsById.get(wizardForm.mechanicId) : undefined;
  const wizardServiceVehicle = wizardForm.serviceCarId ? serviceVehiclesById.get(wizardForm.serviceCarId) : undefined;
  const wizardMissingFields = React.useMemo(() => {
    const labels: Record<string, string> = {
      clientId: 'Выберите клиента',
      rentalId: 'Аренда',
      equipmentId: 'Техника',
      serviceTicketId: 'Сервисная заявка',
      deliveryId: 'Доставка',
      mechanicId: 'Механик',
      serviceCarId: 'Служебный автомобиль',
      parentDocumentId: 'Родительский документ',
      signerName: 'Укажите подписанта',
      signerPosition: 'Укажите должность подписанта',
      signerBasis: 'Укажите основание подписания',
    };
    const missing = (wizardTypeMeta.requiredFields || [])
      .filter(field => field === 'clientId'
        ? !wizardResolvedClientId
        : !wizardForm[field as keyof DocumentWizardState])
      .map(field => labels[field] || field);
    if (wizardForm.type === 'rental_specification') {
      if (!wizardForm.parentDocumentId) missing.push('Договор аренды');
      if (!wizardForm.dailyRate && !wizardForm.amount) missing.push('Ставка или сумма');
    }
    return missing;
  }, [wizardForm, wizardResolvedClientId, wizardTypeMeta]);
  const wizardPreviewRows = React.useMemo(() => ([
    ['Тип', wizardTypeMeta.label],
    ['Дата', wizardForm.type === 'rental_contract' ? 'Будет установлена автоматически' : new Date().toISOString().slice(0, 10)],
    ['Номер', 'Будет сгенерирован автоматически'],
    ['Клиент', wizardClient ? clientLabel(wizardClient) : wizardRental?.client || wizardGanttRental?.client || '—'],
    ['Договор', wizardParentDocument ? `${getDocumentNumber(wizardParentDocument)} от ${formatDate(getDocumentDate(wizardParentDocument))}` : '—'],
    ['Спецификация', wizardSpecification ? `${getDocumentNumber(wizardSpecification)} от ${formatDate(getDocumentDate(wizardSpecification))}` : '—'],
    ...(wizardForm.type === 'rental_contract' ? [
      ['Подписант', wizardForm.signerName || '—'],
      ['Должность', wizardForm.signerPosition || '—'],
      ['Основание подписания', [
        wizardForm.signerBasis,
        wizardForm.signerBasis === 'Доверенность'
          ? [wizardForm.signerBasisNumber, wizardForm.signerBasisDate].filter(Boolean).join(' от ')
          : '',
      ].filter(Boolean).join(' · ') || '—'],
      ['Реквизиты', [wizardForm.clientLegalName, wizardForm.clientInn ? `ИНН ${wizardForm.clientInn}` : '', wizardForm.clientKpp ? `КПП ${wizardForm.clientKpp}` : ''].filter(Boolean).join(' · ') || '—'],
      ['Банк', [wizardForm.clientBankName, wizardForm.clientBankBik ? `БИК ${wizardForm.clientBankBik}` : '', wizardForm.clientBankAccount].filter(Boolean).join(' · ') || '—'],
    ] : []),
    ['Техника', wizardEquipment ? getEquipmentLabel(wizardEquipment) : '—'],
    ['Аренда', wizardRental?.id || '—'],
    ['Период', [wizardForm.rentalStartDate, wizardForm.rentalEndDate].filter(Boolean).join(' — ') || '—'],
    ['Ставка', wizardForm.dailyRate || '—'],
    ['Количество дней', wizardForm.quantityDays || '—'],
    ['Сервис', wizardServiceTicket?.id || '—'],
    ['Доставка', wizardDelivery?.id || '—'],
    ['Механик', wizardMechanic?.name || '—'],
    ['Служебная машина', wizardServiceVehicle ? [wizardServiceVehicle.make, wizardServiceVehicle.model, wizardServiceVehicle.plateNumber].filter(Boolean).join(' ') : '—'],
    ['Статус', 'Черновик'],
    ['Сумма', wizardRental?.amount || wizardRental?.price || wizardGanttRental?.amount ? formatCurrency(Number(wizardRental?.amount || wizardRental?.price || wizardGanttRental?.amount)) : '—'],
  ]).filter(([label]) => {
    if (wizardForm.type === 'rental_contract') return !['Договор', 'Спецификация', 'Техника', 'Аренда', 'Период', 'Ставка', 'Количество дней', 'Сервис', 'Доставка', 'Механик', 'Служебная машина', 'Сумма'].includes(label);
    if (wizardForm.type !== 'rental_specification') return label !== 'Ставка' && label !== 'Количество дней';
    return label !== 'Спецификация';
  }), [wizardClient, wizardDelivery, wizardEquipment, wizardForm, wizardGanttRental, wizardMechanic, wizardParentDocument, wizardRental, wizardServiceTicket, wizardServiceVehicle, wizardSpecification, wizardTypeMeta]);

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
    setRentalReferenceSearch('');
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
    setRentalReferenceSearch('');
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
    setRentalReferenceSearch('');
    const nextForm = {
      ...EMPTY_WIZARD,
      ...initial,
      type: initial.type || EMPTY_WIZARD.type,
    };
    const initialClient = nextForm.clientId ? clientsById.get(nextForm.clientId) : null;
    setWizardForm(initialClient ? fillWizardClientFields(nextForm, initialClient) : nextForm);
    setWizardStep(1);
    setDocumentWizardOpen(true);
  }

  function applyRentalToWizard(value: string) {
    const rental = value === 'none' ? undefined : rentalsById.get(value);
    const gantt = value === 'none' ? undefined : ganttByRentalId.get(value);
    const rentalEndDate = rental?.plannedReturnDate
      || (rental as unknown as Record<string, string | undefined> | undefined)?.endDate
      || gantt?.plannedReturnDate
      || gantt?.endDate
      || '';
    const rentalInv = getRentalEquipmentInventory(rental) || gantt?.equipmentInv || gantt?.inventoryNumber || '';
    const rentalEquipment = rentalInv ? equipmentByInventory.get(rentalInv) : undefined;
    const rate = rentalDailyRate(rental);
    const quantityDays = countRentalDays(rental?.startDate, rentalEndDate);
    setWizardForm(current => ({
      ...current,
      rentalId: value === 'none' ? '' : value,
      clientId: rental?.clientId || gantt?.clientId || current.clientId || '',
      equipmentId: current.equipmentId || rentalEquipment?.id || gantt?.equipmentId || '',
      rentalStartDate: current.rentalStartDate || rental?.startDate || gantt?.startDate || '',
      rentalEndDate: current.rentalEndDate || rentalEndDate,
      dailyRate: current.dailyRate || rate || String(gantt?.rate || ''),
      quantityDays: current.quantityDays || quantityDays,
      amount: current.amount || String((rental as unknown as Record<string, unknown> | undefined)?.amount || rental?.price || gantt?.amount || gantt?.price || ''),
    }));
  }

  function applyParentDocumentToWizard(value: string) {
    const parent = value === 'none' ? undefined : referenceDocuments.find(doc => doc.id === value);
    setWizardForm(current => ({
      ...current,
      parentDocumentId: value === 'none' ? '' : value,
      clientId: parent?.clientId || current.clientId,
    }));
  }

  function applySpecificationToWizard(value: string) {
    const specification = value === 'none' ? undefined : referenceDocuments.find(doc => doc.id === value);
    setWizardForm(current => ({
      ...current,
      specificationId: value === 'none' ? '' : value,
      parentDocumentId: specification?.parentDocumentId || current.parentDocumentId,
      clientId: specification?.clientId || current.clientId,
      rentalId: specification?.rentalId || current.rentalId,
      equipmentId: specification?.equipmentId || current.equipmentId,
      rentalStartDate: specification?.rentalStartDate || current.rentalStartDate,
      rentalEndDate: specification?.rentalEndDate || current.rentalEndDate,
      dailyRate: specification?.dailyRate || current.dailyRate,
      quantityDays: specification?.quantityDays || current.quantityDays,
      amount: specification?.amount ? String(specification.amount) : current.amount,
    }));
  }

  function openDocumentChainAction(source: Doc, type: DocumentType) {
    if (!['rental_specification', 'transfer_act_to_client', 'return_act_from_client'].includes(type)) return;
    setSelectedDocument(null);
    openDocumentWizard({
      type,
      parentDocumentId: source.type === 'rental_contract' ? source.id : source.parentDocumentId || '',
      specificationId: source.type === 'rental_specification' ? source.id : '',
      clientId: source.clientId || '',
      rentalId: source.rentalId || '',
      equipmentId: source.equipmentId || '',
      rentalStartDate: source.rentalStartDate || '',
      rentalEndDate: source.rentalEndDate || '',
      dailyRate: source.dailyRate || '',
      quantityDays: source.quantityDays || '',
      amount: source.amount ? String(source.amount) : '',
    });
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
        clientId: wizardResolvedClientId || undefined,
        client: wizardClient ? clientLabel(wizardClient) : wizardRental?.client || wizardGanttRental?.client || '',
        rentalId: wizardForm.rentalId || undefined,
        equipmentId: wizardForm.equipmentId || undefined,
        deliveryId: wizardForm.deliveryId || undefined,
        serviceTicketId: wizardForm.serviceTicketId || undefined,
        mechanicId: wizardForm.mechanicId || undefined,
        serviceCarId: wizardForm.serviceCarId || undefined,
        parentDocumentId: wizardForm.parentDocumentId || undefined,
        specificationId: wizardForm.specificationId || undefined,
        objectId: wizardRental?.objectId || wizardGanttRental?.objectId,
        contractId: wizardRental?.contractId || wizardGanttRental?.contractId,
        dueDate: wizardForm.dueDate || undefined,
        signerName: wizardForm.signerName.trim() || undefined,
        signerPosition: wizardForm.signerPosition.trim() || undefined,
        signerBasis: wizardForm.signerBasis || undefined,
        signerBasisNumber: wizardForm.signerBasisNumber.trim() || undefined,
        signerBasisDate: wizardForm.signerBasisDate || undefined,
        signatoryName: wizardForm.signerName.trim() || undefined,
        signatoryBasis: wizardForm.signerBasis || undefined,
        clientLegalName: wizardForm.clientLegalName.trim() || undefined,
        clientInn: wizardForm.clientInn.trim() || undefined,
        clientKpp: wizardForm.clientKpp.trim() || undefined,
        clientOgrn: wizardForm.clientOgrn.trim() || undefined,
        clientLegalAddress: wizardForm.clientLegalAddress.trim() || undefined,
        clientPostalAddress: wizardForm.clientPostalAddress.trim() || undefined,
        clientBankName: wizardForm.clientBankName.trim() || undefined,
        clientBankBik: wizardForm.clientBankBik.trim() || undefined,
        clientBankAccount: wizardForm.clientBankAccount.trim() || undefined,
        clientCorrAccount: wizardForm.clientCorrAccount.trim() || undefined,
        rentalStartDate: wizardForm.rentalStartDate || undefined,
        rentalEndDate: wizardForm.rentalEndDate || undefined,
        dailyRate: wizardForm.dailyRate.trim() || undefined,
        quantityDays: wizardForm.quantityDays.trim() || undefined,
        amount: wizardForm.amount.trim() ? Number(wizardForm.amount.replace(',', '.')) : undefined,
        equipmentModel: wizardEquipment ? [wizardEquipment.manufacturer, wizardEquipment.model].filter(Boolean).join(' ') : undefined,
        inventoryNumber: wizardEquipment?.inventoryNumber || undefined,
        serialNumber: wizardEquipment?.serialNumber || undefined,
        transferDate: wizardForm.transferDate || undefined,
        equipmentCondition: wizardForm.equipmentCondition.trim() || undefined,
        completeness: wizardForm.completeness.trim() || undefined,
        companyRepresentative: wizardForm.companyRepresentative.trim() || undefined,
        clientRepresentative: wizardForm.clientRepresentative.trim() || undefined,
        returnDate: wizardForm.returnDate || undefined,
        returnCondition: wizardForm.returnCondition.trim() || undefined,
        damages: wizardForm.damages.trim() || undefined,
        missingItems: wizardForm.missingItems.trim() || undefined,
        serviceRequired: wizardForm.serviceRequired || undefined,
        works: wizardForm.works.trim() || undefined,
        parts: wizardForm.parts.trim() || undefined,
        laborHours: wizardForm.laborHours.trim() || undefined,
        repairResult: wizardForm.repairResult.trim() || undefined,
        tripDate: wizardForm.tripDate || undefined,
        routeFrom: wizardForm.routeFrom.trim() || undefined,
        routeTo: wizardForm.routeTo.trim() || undefined,
        purpose: wizardForm.purpose.trim() || undefined,
        startMileage: wizardForm.startMileage.trim() || undefined,
        endMileage: wizardForm.endMileage.trim() || undefined,
        fuelIssued: wizardForm.fuelIssued.trim() || undefined,
        payload: wizardForm.type === 'rental_contract' ? {
          signer: {
            name: wizardForm.signerName.trim(),
            position: wizardForm.signerPosition.trim(),
            basis: wizardForm.signerBasis,
            basisNumber: wizardForm.signerBasisNumber.trim(),
            basisDate: wizardForm.signerBasisDate,
          },
          requisites: {
            legalName: wizardForm.clientLegalName.trim(),
            inn: wizardForm.clientInn.trim(),
            kpp: wizardForm.clientKpp.trim(),
            ogrn: wizardForm.clientOgrn.trim(),
            legalAddress: wizardForm.clientLegalAddress.trim(),
            postalAddress: wizardForm.clientPostalAddress.trim(),
          },
          bank: {
            bankName: wizardForm.clientBankName.trim(),
            bik: wizardForm.clientBankBik.trim(),
            account: wizardForm.clientBankAccount.trim(),
            corrAccount: wizardForm.clientCorrAccount.trim(),
          },
          notes: wizardForm.notes.trim(),
        } : undefined,
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

  const kpiCards = [
    { label: 'Всего документов', value: registrySummary?.total ?? documents.length, Icon: FileText },
    { label: 'Черновики', value: registrySummary?.draft ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'draft').length, Icon: ClipboardList },
    { label: 'На подписи', value: registrySummary?.pendingSignature ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'pending_signature').length, Icon: FileSignature },
    { label: 'Подписано', value: registrySummary?.signed ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'signed').length, Icon: CheckCircle2 },
    { label: 'Просрочено', value: registrySummary?.expired ?? documents.filter(doc => getSafeDocumentStatus(doc.status) === 'expired').length, Icon: AlertTriangle },
    { label: 'За месяц', value: registrySummary?.currentMonth ?? documents.filter(doc => getDocumentDate(doc).slice(0, 7) === new Date().toISOString().slice(0, 7)).length, Icon: CalendarDays },
  ];
  const quickFilters: Array<[DocumentQuickFilter, string]> = [
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
  ];
  const resetDocumentFilters = () => {
    setSearch('');
    setUnsignedOnly(false);
    setWithoutNumberOnly(false);
    setDuplicatesOnly(false);
    setPeriodFrom('');
    setPeriodTo('');
    setClientFilter('all');
    setRentalFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setSignatureFilter('all');
    setManagerFilter('all');
    setQuickTypeFilter('all');
    setSortKey('date');
  };

  return (
    <div className="min-h-full space-y-4 bg-[#f7f9fc] p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white sm:text-3xl">Документы</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Генерация и контроль договоров, актов, заказ-нарядов и путевых листов.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageDocuments ? (
            <Button onClick={() => openDocumentWizard()} className="bg-lime-300 text-slate-950 hover:bg-lime-200">
              <Plus className="h-4 w-4" />
              Создать документ
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setView('general')} className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]">
            <ClipboardList className="h-4 w-4" />
            Шаблоны
          </Button>
          <Button
            variant="secondary"
            onClick={() => setView('general')}
            className={view === 'general'
              ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]'}
          >
            Документы
          </Button>
          <Button
            variant="secondary"
            onClick={() => setView('control')}
            className={view === 'control'
              ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]'}
          >
            <AlertTriangle className="h-4 w-4" />
            Контроль
          </Button>
          {isAdmin ? (
            <Button variant="secondary" className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]">
              <Settings2 className="h-4 w-4" />
              Настройки полей
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => setView('mechanics')}
            className={view === 'mechanics'
              ? 'bg-lime-300 text-slate-950 hover:bg-lime-200'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1]'}
          >
            <UserRound className="h-4 w-4" />
            Механики
          </Button>
        </div>
      </div>

      {view === 'general' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpiCards.map(({ label, value, Icon }) => (
              <div key={label} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.055] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(132,204,22,0.12),transparent_36%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(190,242,100,0.12),transparent_36%)]" />
                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 text-3xl font-bold text-slate-950 dark:text-white">{value}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-lime-200 bg-lime-50 text-lime-700 dark:border-white/10 dark:bg-slate-900/70 dark:text-lime-200">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="app-scroll-fade-x flex max-w-full gap-2 overflow-x-auto pb-1">
            {quickFilters.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setQuickTypeFilter(key as DocumentQuickFilter);
                  setSignatureFilter(key === 'unsigned' ? 'unsigned' : 'all');
                  if (key === 'unsigned') {
                    setStatusFilter('all');
                  } else {
                    setUnsignedOnly(false);
                  }
                }}
                className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition ${
                  quickTypeFilter === key
                    ? 'bg-lime-300 text-slate-950 shadow-[0_0_22px_rgba(190,242,100,0.18)]'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.1] dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.055] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(150px,1fr))_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <Input
                  placeholder="Поиск по номеру, клиенту, технике, примечанию"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 border-slate-200 bg-white pl-10 text-slate-950 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100">
                  <SelectValue placeholder="Тип документа" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Тип документа</SelectItem>
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Статус</SelectItem>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="sent">Отправлен</SelectItem>
                  <SelectItem value="pending_signature">На подписи</SelectItem>
                  <SelectItem value="signed">Подписан</SelectItem>
                  <SelectItem value="expired">Просрочен</SelectItem>
                  <SelectItem value="cancelled">Отменён</SelectItem>
                </SelectContent>
              </Select>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100">
                  <SelectValue placeholder="Клиент" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Клиент</SelectItem>
                  {(clients as Client[]).map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.company}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={periodFrom}
                  onChange={(event) => setPeriodFrom(event.target.value)}
                  className="h-10 border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100"
                />
                <Input
                  type="date"
                  value={periodTo}
                  onChange={(event) => setPeriodTo(event.target.value)}
                  className="h-10 border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowFilters(true)}
                className="h-10 border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.07] dark:text-slate-200 dark:hover:bg-white/[0.12]"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Фильтры{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {canManageDocuments ? (
                <>
                  <Button variant="secondary" onClick={() => openContractCreate('rental')} className="border border-lime-300 bg-lime-50 text-lime-700 hover:bg-lime-100 dark:border-lime-300/20 dark:bg-lime-300/10 dark:text-lime-100 dark:hover:bg-lime-300/15">
                    <Plus className="h-4 w-4" />
                    Договор аренды
                  </Button>
                  <Button variant="secondary" onClick={() => openContractCreate('supply')} className="border border-lime-300 bg-lime-50 text-lime-700 hover:bg-lime-100 dark:border-lime-300/20 dark:bg-lime-300/10 dark:text-lime-100 dark:hover:bg-lime-300/15">
                    <Plus className="h-4 w-4" />
                    Договор поставки
                  </Button>
                </>
              ) : null}
              <Button variant="secondary" onClick={resetDocumentFilters} className="border border-slate-200 bg-slate-50 px-3 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.1]">
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <FilterDialog
            open={showFilters}
            onOpenChange={setShowFilters}
            title="Фильтры документов"
            description="Отбери документы по подписи, связям, типу, статусу и менеджеру."
            onReset={resetDocumentFilters}
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
                  onClick={() => {
                    setUnsignedOnly(value => {
                      const next = !value;
                      setSignatureFilter(next ? 'unsigned' : 'all');
                      if (next) {
                        setQuickTypeFilter('unsigned');
                        setStatusFilter('all');
                      }
                      return next;
                    });
                  }}
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

          <div className="space-y-3 sm:hidden">
            {documentRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-10 text-center shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.055] dark:shadow-none">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.08]">
                  <Search className="h-7 w-7 text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-base font-medium text-slate-950 dark:text-white">
                  {hasQuickClientContext ? 'Документы по клиенту не найдены' : 'Документы не найдены'}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {hasQuickClientContext
                    ? `Для ${contextFilterLabel(quickActionContext)} нет документов по выбранным фильтрам`
                    : 'Созданные документы появятся здесь карточками с типом, номером, связью, суммой и статусом'}
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
                      onClick={resetDocumentFilters}
                    >
                      Сбросить фильтры
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : documentRows.map((row) => {
              const typeVisual = getDocumentTypeVisual(row.doc);
              const TypeIcon = typeVisual.Icon;
              return (
              <article key={row.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.055] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${typeVisual.className}`}>
                      <TypeIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-slate-950 dark:text-white">{getDocumentTypeLabel(row.doc)}</p>
                      <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                        {row.doc.contractKind ? (row.doc.contractKind === 'rental' ? 'Реестр аренды' : 'Реестр поставки') : 'Документ'}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">{getDocumentStatusPill(row.doc.status)}</div>
                </div>

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950/60">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 dark:text-slate-500">Номер</p>
                      <p className="mt-1 break-words text-base font-semibold text-slate-950 dark:text-white">{row.docNumber || 'Без номера'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-slate-500 dark:text-slate-500">Дата</p>
                      <p className="mt-1 text-sm font-medium text-slate-950 dark:text-white">{row.documentDateLabel}</p>
                    </div>
                  </div>
                  {row.isDuplicate || row.doc.signedScanFileName ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {row.isDuplicate ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-300/15 dark:text-amber-100">Дубль номера</span> : null}
                      {row.doc.signedScanFileName ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-100">Скан загружен</span> : null}
                    </div>
                  ) : null}
                </div>

                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500 dark:text-slate-500">Клиент</dt>
                    <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-100">{displayText(row.clientName)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500 dark:text-slate-500">Аренда / техника</dt>
                    <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-100">{row.linkedEntity}</dd>
                    <dd className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">
                      {[row.equipmentLabel, row.equipmentModel].filter(Boolean).join(' · ') || 'Техника не указана'}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Сумма</dt>
                      <dd className="mt-0.5 break-words font-medium text-slate-700 dark:text-slate-100">{row.amountLabel}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Ответственный</dt>
                      <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-100">{displayText(row.managerName || row.doc.createdBy)}</dd>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500 dark:text-slate-500">Создан / отправлен</dt>
                    <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-100">
                      {row.createdLabel} · {row.sentLabel}{row.signedLabel ? ` · подп. ${row.signedLabel}` : ''}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedDocument(row.doc)}>
                    <Eye className="h-4 w-4" />
                    Детали
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => openDocument(row.doc)}
                    disabled={!row.canOpen}
                  >
                    <Eye className="h-4 w-4" />
                    Открыть
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => downloadDocument(row.doc)}
                    disabled={!row.canDownload}
                  >
                    <Download className="h-4 w-4" />
                    Скачать
                  </Button>
                  {!row.docNumber && canManageDocuments ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void handleAssignNumber(row.doc)}>
                      <FileSignature className="h-4 w-4" />
                      Номер
                    </Button>
                  ) : null}
                </div>
              </article>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-900/70 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] [&_[data-slot=table-container]]:bg-none sm:block">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50 dark:border-white/12 dark:bg-slate-800/70 dark:hover:bg-slate-800/70">
                  <TableHead className="text-slate-500 dark:text-slate-300">Тип</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Номер</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Дата документа</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Клиент</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Техника / Объект</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Статус</TableHead>
                  <TableHead className="text-slate-500 dark:text-slate-300">Связанная сущность</TableHead>
                  <TableHead className="w-20 text-right text-slate-500 dark:text-slate-300">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documentRows.map((row) => {
                  const doc = row.doc;
                  const typeVisual = getDocumentTypeVisual(doc);
                  const TypeIcon = typeVisual.Icon;
                  return (
                  <TableRow key={row.key} className="cursor-pointer border-slate-100 bg-white hover:bg-lime-50/60 dark:border-white/10 dark:bg-slate-900/35 dark:hover:bg-lime-300/[0.07]" onClick={() => setSelectedDocument(doc)}>
                    <TableCell className="max-w-[260px] py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${typeVisual.className}`}>
                          <TypeIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{getDocumentTypeLabel(doc)}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-500">
                            {doc.contractKind ? (doc.contractKind === 'rental' ? 'Реестр аренды' : 'Реестр поставки') : 'Документ'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[160px]">
                      <div>
                        <p className="truncate font-semibold text-slate-950 dark:text-white">{row.docNumber || 'Без номера'}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {row.isDuplicate ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-300/15 dark:text-amber-100">Дубль</span> : null}
                          {doc.signedScanFileName ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-100">Скан</span> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">{row.documentDateLabel}</TableCell>
                    <TableCell className="max-w-[210px]">
                      <p className="truncate text-sm text-slate-700 dark:text-slate-100">{displayText(row.clientName)}</p>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm text-slate-700 dark:text-slate-100">{row.equipmentLabel}</p>
                      {row.equipmentModel ? (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-500">{row.equipmentModel}</p>
                      ) : null}
                      {doc.objectId ? (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-500">Объект {doc.objectId}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>{getDocumentStatusPill(doc.status)}</TableCell>
                    <TableCell className="max-w-[240px]">
                      <p className="truncate text-sm text-slate-700 dark:text-slate-100">{row.linkedEntity}</p>
                      {row.rentalId ? (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-500">Аренда: {row.rentalId}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <details className="relative inline-block" onClick={(event) => event.stopPropagation()}>
                        <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.12] [&::-webkit-details-marker]:hidden">
                          <MoreHorizontal className="h-4 w-4" />
                        </summary>
                        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl dark:border-white/10 dark:bg-slate-900">
                          <button type="button" onClick={() => setSelectedDocument(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                            <Eye className="h-4 w-4" />
                            Детали
                          </button>
                          <button type="button" onClick={() => openDocument(doc)} disabled={!row.canOpen} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-white/[0.08] dark:disabled:text-slate-600">
                            <Eye className="h-4 w-4" />
                            Открыть
                          </button>
                          <button type="button" onClick={() => downloadDocument(doc)} disabled={!row.canDownload} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-white/[0.08] dark:disabled:text-slate-600">
                            <Download className="h-4 w-4" />
                            Скачать
                          </button>
                          {!row.docNumber && canManageDocuments ? (
                            <button type="button" onClick={() => void handleAssignNumber(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                              <FileSignature className="h-4 w-4" />
                              Присвоить номер
                            </button>
                          ) : null}
                          {canManageDocuments && doc.type === 'contract' ? (
                            <button type="button" onClick={() => startMarkAsSigned(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                              {doc.status === 'signed' ? <CheckCircle2 className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                              {doc.signedScanDataUrl ? 'Заменить скан' : 'Загрузить скан'}
                            </button>
                          ) : null}
                          {canManageDocuments && doc.type === 'rental_contract' ? (
                            <>
                              <button type="button" onClick={() => openDocumentChainAction(doc, 'rental_specification')} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <ClipboardList className="h-4 w-4" />
                                Создать спецификацию
                              </button>
                              <button type="button" onClick={() => openDocumentChainAction(doc, 'transfer_act_to_client')} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <Send className="h-4 w-4" />
                                Создать акт передачи
                              </button>
                              <button type="button" onClick={() => openDocumentChainAction(doc, 'return_act_from_client')} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <Printer className="h-4 w-4" />
                                Создать акт возврата
                              </button>
                            </>
                          ) : null}
                          {canManageDocuments ? (
                            <>
                              <button type="button" onClick={() => void handleMarkSent(doc, 'pending_signature')} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <Send className="h-4 w-4" />
                                Отметить на подписи
                              </button>
                              <button type="button" onClick={() => void handleMarkSigned(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <CheckCircle2 className="h-4 w-4" />
                                Отметить подписанным
                              </button>
                              <button type="button" onClick={() => void handleDuplicateDocument(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                                <Layers3 className="h-4 w-4" />
                                Дублировать
                              </button>
                              {isAdmin ? (
                                <button type="button" onClick={() => void handleDeleteDocument(doc)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-200 dark:hover:bg-rose-500/10">
                                  <Trash2 className="h-4 w-4" />
                                  Удалить
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {filteredDocuments.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.08]">
                  <Search className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-lg font-medium text-slate-950 dark:text-white">
                  {hasQuickClientContext ? 'Документы по клиенту не найдены' : 'Документы не найдены'}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {hasQuickClientContext
                    ? `Для ${contextFilterLabel(quickActionContext)} нет документов по выбранным фильтрам`
                    : 'Попробуйте изменить параметры поиска или фильтры'}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {canManageDocuments ? (
                    <Button onClick={() => openDocumentWizard()} className="bg-lime-300 text-slate-950 hover:bg-lime-200">
                      <Plus className="h-4 w-4" />
                      Создать документ
                    </Button>
                  ) : null}
                  {activeFilterCount > 0 ? (
                    <Button variant="secondary" onClick={resetDocumentFilters}>
                      Сбросить фильтры
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <PaginationControls
            pagination={documentsQuery.data?.pagination}
            loading={documentsQuery.isFetching}
            onPageChange={documentPagination.setPage}
            onPageSizeChange={documentPagination.setPageSize}
          />

          <Dialog open={documentWizardOpen} onOpenChange={setDocumentWizardOpen}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5" />
                  Создать документ
                </DialogTitle>
                <DialogDescription>
                  Выберите тип документа, затем заполните только поля, которые относятся к этому документу.
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[64vh] space-y-5 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map(step => (
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

                {wizardStep === 2 && wizardForm.type === 'rental_contract' ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Договор аренды</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Создайте юридическую рамку договора с клиентом. Техника, сроки и ставки добавляются в спецификации.</p>
                      <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">Договор фиксирует стороны и реквизиты. Конкретная техника и цена указываются в спецификации к договору.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium text-foreground">Клиент</div>
                        <ClientCombobox
                          clients={clients as Client[]}
                          value={wizardClient ? clientLabel(wizardClient) : ''}
                          valueId={wizardResolvedClientId}
                          onChange={(value) => {
                            if (!value) setWizardForm(current => ({ ...current, clientId: '' }));
                          }}
                          onClientSelect={(client) => setWizardForm(current => fillWizardClientFields(current, client))}
                          placeholder={(clients as Client[]).length > 0 ? 'Выберите клиента из базы' : 'Клиенты не найдены'}
                          initialLimit={20}
                        />
                        {(clients as Client[]).length === 0 ? (
                          <p className="text-xs text-muted-foreground">Клиенты не найдены</p>
                        ) : null}
                        {wizardClient && !wizardForm.clientInn && !wizardForm.clientLegalAddress ? (
                          <p className="text-xs text-amber-700 dark:text-amber-300">Реквизиты клиента не заполнены. Можно создать черновик и дозаполнить позже.</p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Юридическое название клиента</div>
                        <Input value={wizardForm.clientLegalName} onChange={(event) => setWizardForm(current => ({ ...current, clientLegalName: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">ИНН</div>
                        <Input value={wizardForm.clientInn} onChange={(event) => setWizardForm(current => ({ ...current, clientInn: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">КПП</div>
                        <Input value={wizardForm.clientKpp} onChange={(event) => setWizardForm(current => ({ ...current, clientKpp: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">ОГРН</div>
                        <Input value={wizardForm.clientOgrn} onChange={(event) => setWizardForm(current => ({ ...current, clientOgrn: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Юридический адрес</div>
                        <Textarea rows={2} value={wizardForm.clientLegalAddress} onChange={(event) => setWizardForm(current => ({ ...current, clientLegalAddress: event.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Почтовый адрес</div>
                        <Textarea rows={2} value={wizardForm.clientPostalAddress} onChange={(event) => setWizardForm(current => ({ ...current, clientPostalAddress: event.target.value }))} />
                      </div>
                    </div>
                  </div>
                ) : null}

                {wizardStep === 3 && wizardForm.type === 'rental_contract' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">ФИО подписанта</div>
                      <Input value={wizardForm.signerName} onChange={(event) => setWizardForm(current => ({ ...current, signerName: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Должность подписанта</div>
                      <Input value={wizardForm.signerPosition} onChange={(event) => setWizardForm(current => ({ ...current, signerPosition: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Основание подписания</div>
                      <Select value={wizardForm.signerBasis || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, signerBasis: value === 'none' ? '' : value }))}>
                        <SelectTrigger><SelectValue placeholder="Выберите основание" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не выбрано</SelectItem>
                          {['Устав', 'Доверенность', 'Приказ', 'Иное'].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {wizardForm.signerBasis === 'Доверенность' ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Номер доверенности</div>
                          <Input value={wizardForm.signerBasisNumber} onChange={(event) => setWizardForm(current => ({ ...current, signerBasisNumber: event.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Дата доверенности</div>
                          <Input type="date" value={wizardForm.signerBasisDate} onChange={(event) => setWizardForm(current => ({ ...current, signerBasisDate: event.target.value }))} />
                        </div>
                      </>
                    ) : null}
                    <div className="space-y-2 md:col-span-2">
                      <div className="text-sm font-medium text-foreground">Комментарий</div>
                      <Textarea rows={3} value={wizardForm.notes} onChange={(event) => setWizardForm(current => ({ ...current, notes: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {wizardStep === 4 && wizardForm.type === 'rental_contract' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Банк</div>
                      <Input value={wizardForm.clientBankName} onChange={(event) => setWizardForm(current => ({ ...current, clientBankName: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">БИК</div>
                      <Input value={wizardForm.clientBankBik} onChange={(event) => setWizardForm(current => ({ ...current, clientBankBik: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Расчётный счёт</div>
                      <Input value={wizardForm.clientBankAccount} onChange={(event) => setWizardForm(current => ({ ...current, clientBankAccount: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Корреспондентский счёт</div>
                      <Input value={wizardForm.clientCorrAccount} onChange={(event) => setWizardForm(current => ({ ...current, clientCorrAccount: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {wizardStep === 2 && wizardForm.type !== 'rental_contract' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                        {wizardForm.type === 'rental_specification'
                          ? 'Спецификация привязывается к договору и фиксирует технику, срок аренды, ставку и сумму.'
                          : wizardForm.type === 'transfer_act_to_client'
                            ? 'Акт подтверждает передачу конкретной техники клиенту.'
                            : wizardForm.type === 'return_act_from_client'
                              ? 'Акт фиксирует возврат техники, состояние и замечания.'
                              : 'Заполните связи документа.'}
                      </p>
                    </div>
                    {['rental_specification', 'transfer_act_to_client', 'return_act_from_client'].includes(wizardForm.type) ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Клиент</div>
                        <ClientCombobox
                          clients={clients as Client[]}
                          value={wizardClient ? clientLabel(wizardClient) : ''}
                          valueId={wizardResolvedClientId}
                          onChange={(value) => {
                            if (!value) setWizardForm(current => ({ ...current, clientId: '' }));
                          }}
                          onClientSelect={(client) => setWizardForm(current => ({ ...current, clientId: client?.id ?? '' }))}
                          placeholder={(clients as Client[]).length > 0 ? 'Выберите клиента из базы' : 'Клиенты не найдены'}
                          initialLimit={20}
                        />
                      </div>
                    ) : null}
                    {wizardForm.type === 'rental_specification' ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Договор аренды</div>
                        <Select value={wizardForm.parentDocumentId || 'none'} onValueChange={applyParentDocumentToWizard}>
                          <SelectTrigger><SelectValue placeholder="Выберите договор" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Не выбран</SelectItem>
                            {referenceDocuments.filter(doc => doc.type === 'rental_contract').map(doc => <SelectItem key={doc.id} value={doc.id}>{getDocumentNumber(doc)} · {doc.client || doc.clientId}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    {['transfer_act_to_client', 'return_act_from_client'].includes(wizardForm.type) ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Договор аренды</div>
                          <Select value={wizardForm.parentDocumentId || 'none'} onValueChange={applyParentDocumentToWizard}>
                            <SelectTrigger><SelectValue placeholder="Выберите договор" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Не выбран</SelectItem>
                              {referenceDocuments.filter(doc => doc.type === 'rental_contract').map(doc => <SelectItem key={doc.id} value={doc.id}>{getDocumentNumber(doc)} · {doc.client || doc.clientId}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Спецификация</div>
                          <Select value={wizardForm.specificationId || 'none'} onValueChange={applySpecificationToWizard}>
                            <SelectTrigger><SelectValue placeholder="Выберите спецификацию" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Не выбрана</SelectItem>
                              {referenceDocuments.filter(doc => doc.type === 'rental_specification' && (!wizardForm.parentDocumentId || doc.parentDocumentId === wizardForm.parentDocumentId)).map(doc => <SelectItem key={doc.id} value={doc.id}>{getDocumentNumber(doc)} · {doc.client || doc.clientId}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                    {['rental_specification', 'transfer_act_to_client', 'return_act_from_client'].includes(wizardForm.type) ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Аренда</div>
                          <Input
                            value={rentalReferenceSearch}
                            onChange={(event) => setRentalReferenceSearch(event.target.value)}
                            placeholder="Поиск аренды, клиента или техники"
                          />
                          <Select value={wizardForm.rentalId || 'none'} onValueChange={applyRentalToWizard}>
                            <SelectTrigger><SelectValue placeholder="Выберите аренду" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Не выбрана</SelectItem>
                              {rentalReferenceOptions.map(rental => <SelectItem key={rental.id} value={rental.id}>{rental.label}</SelectItem>)}
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
                      </>
                    ) : null}
                    {['work_order', 'trip_ticket'].includes(wizardForm.type) ? (
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
                    ) : null}
                    {wizardForm.type === 'work_order' ? (
                      <>
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
                          <div className="text-sm font-medium text-foreground">Механик</div>
                          <Select value={wizardForm.mechanicId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, mechanicId: value === 'none' ? '' : value }))}>
                            <SelectTrigger><SelectValue placeholder="Выберите механика" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Не выбран</SelectItem>
                              {mechanicList.map(mechanic => <SelectItem key={mechanic.id} value={mechanic.id}>{mechanic.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                    {wizardForm.type === 'trip_ticket' ? (
                      <>
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
                          <div className="text-sm font-medium text-foreground">Водитель/механик</div>
                          <Select value={wizardForm.mechanicId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, mechanicId: value === 'none' ? '' : value }))}>
                            <SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Не выбран</SelectItem>
                              {mechanicList.map(mechanic => <SelectItem key={mechanic.id} value={mechanic.id}>{mechanic.name}</SelectItem>)}
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
                      </>
                    ) : null}
                    {['transfer_act_to_client', 'return_act_from_client'].includes(wizardForm.type) ? (
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
                    ) : null}
                  </div>
                ) : null}

                {wizardStep === 3 && wizardForm.type !== 'rental_contract' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {wizardForm.type === 'rental_specification' ? (
                      <>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Период с</div><Input type="date" value={wizardForm.rentalStartDate} onChange={(event) => setWizardForm(current => ({ ...current, rentalStartDate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Период по</div><Input type="date" value={wizardForm.rentalEndDate} onChange={(event) => setWizardForm(current => ({ ...current, rentalEndDate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Ставка</div><Input value={wizardForm.dailyRate} onChange={(event) => setWizardForm(current => ({ ...current, dailyRate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Количество дней</div><Input value={wizardForm.quantityDays} onChange={(event) => setWizardForm(current => ({ ...current, quantityDays: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Сумма</div><Input value={wizardForm.amount} onChange={(event) => setWizardForm(current => ({ ...current, amount: event.target.value }))} /></div>
                      </>
                    ) : null}
                    {wizardForm.type === 'transfer_act_to_client' ? (
                      <>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Дата передачи</div><Input type="date" value={wizardForm.transferDate} onChange={(event) => setWizardForm(current => ({ ...current, transferDate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Состояние техники</div><Input value={wizardForm.equipmentCondition} onChange={(event) => setWizardForm(current => ({ ...current, equipmentCondition: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Комплектность</div><Input value={wizardForm.completeness} onChange={(event) => setWizardForm(current => ({ ...current, completeness: event.target.value }))} /></div>
                      </>
                    ) : null}
                    {wizardForm.type === 'return_act_from_client' ? (
                      <>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Дата возврата</div><Input type="date" value={wizardForm.returnDate} onChange={(event) => setWizardForm(current => ({ ...current, returnDate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Состояние при возврате</div><Input value={wizardForm.returnCondition} onChange={(event) => setWizardForm(current => ({ ...current, returnCondition: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Повреждения</div><Input value={wizardForm.damages} onChange={(event) => setWizardForm(current => ({ ...current, damages: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Недостача</div><Input value={wizardForm.missingItems} onChange={(event) => setWizardForm(current => ({ ...current, missingItems: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Нужна сервисная заявка</div><Select value={wizardForm.serviceRequired || 'Нет'} onValueChange={(value) => setWizardForm(current => ({ ...current, serviceRequired: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Нет">Нет</SelectItem><SelectItem value="Да">Да</SelectItem></SelectContent></Select></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Сервисная заявка</div><Select value={wizardForm.serviceTicketId || 'none'} onValueChange={(value) => setWizardForm(current => ({ ...current, serviceTicketId: value === 'none' ? '' : value }))}><SelectTrigger><SelectValue placeholder="Выберите заявку" /></SelectTrigger><SelectContent><SelectItem value="none">Не выбрана</SelectItem>{(serviceTickets as ServiceTicket[]).map(ticket => <SelectItem key={ticket.id} value={ticket.id}>{ticket.id} · {ticket.reason || ticket.description || 'Сервис'}</SelectItem>)}</SelectContent></Select></div>
                      </>
                    ) : null}
                    {wizardForm.type === 'work_order' ? (
                      <>
                        <div className="space-y-2 md:col-span-2"><div className="text-sm font-medium text-foreground">Работы</div><Textarea rows={3} value={wizardForm.works} onChange={(event) => setWizardForm(current => ({ ...current, works: event.target.value }))} /></div>
                        <div className="space-y-2 md:col-span-2"><div className="text-sm font-medium text-foreground">Запчасти</div><Textarea rows={3} value={wizardForm.parts} onChange={(event) => setWizardForm(current => ({ ...current, parts: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Трудозатраты</div><Input value={wizardForm.laborHours} onChange={(event) => setWizardForm(current => ({ ...current, laborHours: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Итог ремонта</div><Input value={wizardForm.repairResult} onChange={(event) => setWizardForm(current => ({ ...current, repairResult: event.target.value }))} /></div>
                      </>
                    ) : null}
                    {wizardForm.type === 'trip_ticket' ? (
                      <>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Дата поездки</div><Input type="date" value={wizardForm.tripDate} onChange={(event) => setWizardForm(current => ({ ...current, tripDate: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Откуда</div><Input value={wizardForm.routeFrom} onChange={(event) => setWizardForm(current => ({ ...current, routeFrom: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Куда</div><Input value={wizardForm.routeTo} onChange={(event) => setWizardForm(current => ({ ...current, routeTo: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Цель</div><Input value={wizardForm.purpose} onChange={(event) => setWizardForm(current => ({ ...current, purpose: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Начальный пробег</div><Input value={wizardForm.startMileage} onChange={(event) => setWizardForm(current => ({ ...current, startMileage: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Конечный пробег</div><Input value={wizardForm.endMileage} onChange={(event) => setWizardForm(current => ({ ...current, endMileage: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Топливо</div><Input value={wizardForm.fuelIssued} onChange={(event) => setWizardForm(current => ({ ...current, fuelIssued: event.target.value }))} /></div>
                      </>
                    ) : null}
                    {['transfer_act_to_client', 'return_act_from_client'].includes(wizardForm.type) ? (
                      <>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Представитель компании</div><Input value={wizardForm.companyRepresentative} onChange={(event) => setWizardForm(current => ({ ...current, companyRepresentative: event.target.value }))} /></div>
                        <div className="space-y-2"><div className="text-sm font-medium text-foreground">Представитель клиента</div><Input value={wizardForm.clientRepresentative} onChange={(event) => setWizardForm(current => ({ ...current, clientRepresentative: event.target.value }))} /></div>
                      </>
                    ) : null}
                    <div className="space-y-2 md:col-span-2">
                      <div className="text-sm font-medium text-foreground">Комментарий / примечания</div>
                      <Textarea rows={3} value={wizardForm.notes} onChange={(event) => setWizardForm(current => ({ ...current, notes: event.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {wizardStep === 4 && wizardForm.type !== 'rental_contract' ? (
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
                    <Input
                      value={rentalReferenceSearch}
                      onChange={(event) => setRentalReferenceSearch(event.target.value)}
                      placeholder="Поиск аренды, клиента или техники"
                    />
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
                        {relatedRentalOptions.map(rental => (
                          <SelectItem key={rental.id} value={rental.id}>{rental.label}</SelectItem>
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
                    {canManageDocuments && selectedDocument.type === 'rental_contract' ? (
                      <>
                        <Button variant="secondary" onClick={() => openDocumentChainAction(selectedDocument, 'rental_specification')}>
                          Создать спецификацию
                        </Button>
                        <Button variant="secondary" onClick={() => openDocumentChainAction(selectedDocument, 'transfer_act_to_client')}>
                          Создать акт передачи
                        </Button>
                        <Button variant="secondary" onClick={() => openDocumentChainAction(selectedDocument, 'return_act_from_client')}>
                          Создать акт возврата
                        </Button>
                      </>
                    ) : null}
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
              ['Аренды без договора', documentControl.kpi.rentalsWithoutContract],
              ['Без спецификации', documentControl.kpi.rentalsWithoutSpecification],
              ['Без акта передачи', documentControl.kpi.rentalsWithoutTransferAct],
              ['Закрытые без акта возврата', documentControl.kpi.closedRentalsWithoutReturnAct],
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
