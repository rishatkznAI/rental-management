import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  ArrowLeft, CircleAlert, FileText, Image as ImageIcon, Wrench, Camera,
  DollarSign, TrendingUp, Clock, Plus, Bot, User, Calendar,
  CheckCircle, AlertTriangle, MapPin, ChevronRight, ChevronDown, MessageSquare,
  Upload, Trash2, X, PenLine, RotateCcw, Download,
} from 'lucide-react';
import {
} from '../mock-data';
import type { ShippingPhoto, ServiceTicket, Payment, EquipmentStatus, EquipmentOperationPhotoCategory, ShippingEventType } from '../types';
import { formatDate, formatDateTime, formatCurrency, getDaysUntil, getRentalDays, getRentalOverlapDays } from '../lib/utils';
import { cn } from '../lib/utils';
import * as Dialog from '@radix-ui/react-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import type { Equipment, EquipmentOwnerType, EquipmentSalePdiStatus, RepairEventType } from '../types';
import { EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_PRIORITY_LABELS, EQUIPMENT_SALE_PDI_LABELS } from '../lib/equipmentClassification';
import type { GanttRentalData } from '../mock-data';
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { isMechanicRole } from '../lib/userStorage';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { paymentsService } from '../services/payments.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { documentsService } from '../services/documents.service';
import { clientsService } from '../services/clients.service';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { PAYMENT_KEYS } from '../hooks/usePayments';
import { SERVICE_TICKET_KEYS } from '../hooks/useServiceTickets';
import { ServiceTicketForm } from '../components/service/ServiceTicketForm';
import { appendAuditHistory, buildFieldDiffHistory, createAuditEntry } from '../lib/entity-history';
import { getToken } from '../lib/api';
import { findEquipmentTypeLabel, useEquipmentTypeCatalog } from '../lib/equipmentTypes';
import { buildEquipment360Summary } from '../lib/equipment360.js';
import { buildEquipmentQuickActions } from '../lib/quickActions.js';

const ownerLabels: Record<EquipmentOwnerType, string> = {
  own: 'Собственная',
  investor: 'Техника инвестора',
  sublease: 'Субаренда',
};

const repairTypeLabels: Record<RepairEventType, string> = {
  repair: 'Ремонт',
  maintenance: 'Обслуживание',
  diagnostics: 'Диагностика',
  breakdown: 'Поломка',
};

const repairTypeBadge: Record<RepairEventType, 'danger' | 'warning' | 'info' | 'error'> = {
  repair: 'warning',
  maintenance: 'info',
  diagnostics: 'info',
  breakdown: 'error',
};

const EQ_STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Свободна',
  rented: 'В аренде',
  reserved: 'Забронирована',
  in_service: 'В сервисе',
  inactive: 'Списана',
};

const SERVICE_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово',
  closed: 'Закрыта',
};

const HANDOFF_CHECKLIST_LABELS = {
  exterior: 'Внешний осмотр выполнен',
  controlPanel: 'Пульт проверен',
  batteryCharge: 'АКБ / заряд проверены',
  basket: 'Люлька / рабочая платформа проверены',
  tires: 'Колёса / шины осмотрены',
  leaksAndDamage: 'Течи / повреждения осмотрены',
} as const;

const PHOTO_CATEGORY_LABELS = {
  front: 'Спереди',
  rear: 'Сзади',
  side_1: 'Сбоку 1',
  side_2: 'Сбоку 2',
  plate: 'Шильдик',
  hours_photo: 'Моточасы',
  control_panel: 'Пульт',
  basket: 'Люлька',
  engine_bay: 'Подкапотное пространство',
  damage_photo: 'Повреждения',
} as const;

const HANDOFF_REQUIRED_PHOTO_CATEGORIES: EquipmentOperationPhotoCategory[] = [
  'front',
  'rear',
  'side_1',
  'side_2',
  'plate',
  'hours_photo',
  'control_panel',
  'basket',
  'engine_bay',
];

const textEncoder = new TextEncoder();
const API_BASE_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

function sanitizeZipSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'file';
}

function inferPhotoExtension(url: string, contentType?: string) {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('gif')) return 'gif';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg';

  if (url.startsWith('data:image/')) {
    const match = url.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
    if (match?.[1]) {
      return match[1] === 'jpeg' ? 'jpg' : match[1];
    }
  }

  try {
    const pathname = new URL(url, window.location.href).pathname;
    const fileName = pathname.split('/').pop() || '';
    const ext = fileName.split('.').pop();
    if (ext && ext.length <= 5) return ext.toLowerCase();
  } catch {
    // Ignore malformed URLs and fall back to jpg.
  }

  return 'jpg';
}

function dataUrlToBytes(url: string) {
  const [meta, body = ''] = url.split(',', 2);
  const isBase64 = meta.includes(';base64');
  if (isBase64) {
    const binary = window.atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return textEncoder.encode(decodeURIComponent(body));
}

function crc32(bytes: Uint8Array) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function getDosDateTime(date: Date) {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(safeDate.getFullYear(), 1980);
  const dosTime = ((safeDate.getHours() & 0x1f) << 11)
    | ((safeDate.getMinutes() & 0x3f) << 5)
    | ((Math.floor(safeDate.getSeconds() / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9)
    | (((safeDate.getMonth() + 1) & 0x0f) << 5)
    | (safeDate.getDate() & 0x1f);
  return { dosDate, dosTime };
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function buildZip(entries: Array<{ name: string; data: Uint8Array; date?: Date }>) {
  const fileBytes: number[] = [];
  const centralDirectory: number[] = [];
  let offset = 0;

  entries.forEach(entry => {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { dosDate, dosTime } = getDosDateTime(entry.date ?? new Date());

    writeUint32(fileBytes, 0x04034b50);
    writeUint16(fileBytes, 20);
    writeUint16(fileBytes, 0x0800);
    writeUint16(fileBytes, 0);
    writeUint16(fileBytes, dosTime);
    writeUint16(fileBytes, dosDate);
    writeUint32(fileBytes, crc);
    writeUint32(fileBytes, size);
    writeUint32(fileBytes, size);
    writeUint16(fileBytes, nameBytes.length);
    writeUint16(fileBytes, 0);
    fileBytes.push(...nameBytes);
    fileBytes.push(...entry.data);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, dosTime);
    writeUint16(centralDirectory, dosDate);
    writeUint32(centralDirectory, crc);
    writeUint32(centralDirectory, size);
    writeUint32(centralDirectory, size);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);

    offset = fileBytes.length;
  });

  const centralDirectoryOffset = fileBytes.length;
  fileBytes.push(...centralDirectory);
  writeUint32(fileBytes, 0x06054b50);
  writeUint16(fileBytes, 0);
  writeUint16(fileBytes, 0);
  writeUint16(fileBytes, entries.length);
  writeUint16(fileBytes, entries.length);
  writeUint32(fileBytes, centralDirectory.length);
  writeUint32(fileBytes, centralDirectoryOffset);
  writeUint16(fileBytes, 0);

  return new Blob([new Uint8Array(fileBytes)], { type: 'application/zip' });
}

function createEmptyHandoffChecklist() {
  return {
    exterior: false,
    controlPanel: false,
    batteryCharge: false,
    basket: false,
    tires: false,
    leaksAndDamage: false,
  };
}

function createEmptyPhotoCategories(includeDamage = false): Partial<Record<EquipmentOperationPhotoCategory, string[]>> {
  return {
    front: [],
    rear: [],
    side_1: [],
    side_2: [],
    plate: [],
    hours_photo: [],
    control_panel: [],
    basket: [],
    engine_bay: [],
    ...(includeDamage ? { damage_photo: [] } : {}),
  };
}

function isChecklistComplete(checklist: ReturnType<typeof createEmptyHandoffChecklist>) {
  return Object.values(checklist).every(Boolean);
}

function isPhotoCategoryComplete(
  categories: Partial<Record<EquipmentOperationPhotoCategory, string[]>>,
  eventType: ShippingEventType,
) {
  const required = eventType === 'receiving'
    ? [...HANDOFF_REQUIRED_PHOTO_CATEGORIES, 'damage_photo' as const]
    : HANDOFF_REQUIRED_PHOTO_CATEGORIES;
  return required.every(key => (categories[key] ?? []).length > 0);
}

function getMissingPhotoCategoryLabels(
  categories: Partial<Record<EquipmentOperationPhotoCategory, string[]>>,
  eventType: ShippingEventType,
) {
  const required = eventType === 'receiving'
    ? [...HANDOFF_REQUIRED_PHOTO_CATEGORIES, 'damage_photo' as const]
    : HANDOFF_REQUIRED_PHOTO_CATEGORIES;
  return required
    .filter(key => (categories[key] ?? []).length === 0)
    .map(key => PHOTO_CATEGORY_LABELS[key]);
}

function escapeHtml(value: string) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function printHandoffAct(event: ShippingPhoto, equipment: Equipment) {
  const photoGroups = event.photoCategories && Object.keys(event.photoCategories).length > 0
    ? Object.entries(PHOTO_CATEGORY_LABELS)
        .map(([key, label]) => ({
          label,
          photos: event.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS] || [],
        }))
        .filter(group => group.photos.length > 0)
    : [{ label: 'Фотографии', photos: event.photos || [] }];

  const checklistRows = event.checklist
    ? Object.entries(HANDOFF_CHECKLIST_LABELS).map(([key, label]) => `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${event.checklist?.[key as keyof typeof HANDOFF_CHECKLIST_LABELS] ? 'Проверено' : 'Не отмечено'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="2">Чек-лист не заполнен</td></tr>';

  const photoSections = photoGroups.map(group => `
    <section style="margin-top:16px;">
      <h3 style="margin:0 0 8px;font-size:14px;">${escapeHtml(group.label)}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${group.photos.map(photo => `
          <div style="width:180px;">
            <img src="${photo}" style="width:100%;height:130px;object-fit:cover;border:1px solid #d1d5db;border-radius:6px;" />
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');

  const title = `${event.type === 'shipping' ? 'Акт отгрузки' : 'Акт приёмки'} ${equipment.inventoryNumber}`;
  const html = `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 24px; }
          h1, h2, h3 { color: #111827; }
          .meta { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin-bottom:16px; }
          .card { border:1px solid #d1d5db; border-radius:8px; padding:12px; }
          table { width:100%; border-collapse: collapse; margin-top:8px; }
          th, td { border:1px solid #d1d5db; padding:8px; text-align:left; font-size:12px; }
          th { background:#f3f4f6; }
          .muted { color:#6b7280; font-size:12px; }
          .actions { margin-bottom:16px; display:flex; gap:8px; }
          .action-btn {
            border:1px solid #d1d5db;
            background:#ffffff;
            color:#111827;
            border-radius:8px;
            padding:8px 12px;
            font-size:12px;
            cursor:pointer;
          }
          .action-btn:hover { background:#f9fafb; }
          @media print { body { margin: 12mm; } .actions { display:none; } }
        </style>
      </head>
      <body>
        <div class="actions">
          <button class="action-btn" onclick="window.print()">Печать</button>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">Дата операции: ${escapeHtml(formatDate(event.date))} · Исполнитель: ${escapeHtml(event.uploadedBy)}</p>
        <div class="meta">
          <div class="card">
            <strong>Техника</strong>
            <div>${escapeHtml(equipment.manufacturer)} ${escapeHtml(equipment.model)}</div>
            <div>INV: ${escapeHtml(equipment.inventoryNumber)}</div>
            <div>SN: ${escapeHtml(equipment.serialNumber)}</div>
          </div>
          <div class="card">
            <strong>Состояние</strong>
            <div>Моточасы: ${escapeHtml(String(event.hoursValue ?? equipment.hours ?? '—'))}</div>
            <div>Тип события: ${event.type === 'shipping' ? 'Отгрузка' : 'Приёмка'}</div>
            ${event.damageDescription ? `<div>Повреждения: ${escapeHtml(event.damageDescription)}</div>` : ''}
          </div>
        </div>
        <section>
          <h2 style="font-size:16px;margin:0 0 8px;">Чек-лист</h2>
          <table>
            <thead>
              <tr><th>Пункт</th><th>Статус</th></tr>
            </thead>
            <tbody>${checklistRows}</tbody>
          </table>
        </section>
        ${event.comment ? `<section style="margin-top:16px;"><h2 style="font-size:16px;margin:0 0 8px;">Комментарий</h2><div class="card">${escapeHtml(event.comment)}</div></section>` : ''}
        ${event.damageDescription ? `<section style="margin-top:16px;"><h2 style="font-size:16px;margin:0 0 8px;">Описание повреждений</h2><div class="card">${escapeHtml(event.damageDescription)}</div></section>` : ''}
        ${photoSections}
        <section style="margin-top:20px;">
          <h2 style="font-size:16px;margin:0 0 8px;">Подпись</h2>
          <div class="card">
            <div><strong>Подписал:</strong> ${escapeHtml(event.signedBy || event.uploadedBy)}</div>
            <div><strong>Дата подписи:</strong> ${escapeHtml(event.signedAt ? formatDateTime(event.signedAt) : formatDate(event.date))}</div>
            ${event.signatureDataUrl ? `<div style="margin-top:12px;"><img src="${event.signatureDataUrl}" style="max-width:240px;max-height:100px;object-fit:contain;border-bottom:1px solid #9ca3af;" /></div>` : '<div style="margin-top:12px;color:#6b7280;">Подпись не приложена</div>'}
          </div>
        </section>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, '_blank', 'width=1100,height=900');

  if (!popup) {
    URL.revokeObjectURL(url);
    return;
  }

  const revokeUrl = () => {
    URL.revokeObjectURL(url);
  };

  popup.addEventListener('load', () => {
    setTimeout(revokeUrl, 1000);
  }, { once: true });
}

type ShippingPhotoGroup = {
  key: string;
  label: string;
  photos: string[];
};

type ShippingPhotoAsset = {
  label: string;
  url: string;
};

type ShippingComparisonPair = {
  id: string;
  shipping: ShippingPhoto;
  receiving: ShippingPhoto;
};

function getShippingPhotoGroups(event: ShippingPhoto): ShippingPhotoGroup[] {
  if (event.photoCategories && Object.keys(event.photoCategories).length > 0) {
    return Object.entries(PHOTO_CATEGORY_LABELS)
      .map(([key, label]) => ({
        key,
        label,
        photos: Array.isArray(event.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS])
          ? event.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS] || []
          : [],
      }))
      .filter(group => group.photos.length > 0);
  }

  return Array.isArray(event.photos) && event.photos.length > 0
    ? [{ key: 'generic', label: 'Фотографии', photos: event.photos.filter((photo): photo is string => typeof photo === 'string' && photo.trim().length > 0) }]
    : [];
}

function getShippingPhotoAssets(event: ShippingPhoto): ShippingPhotoAsset[] {
  const groupedAssets = event.photoCategories && Object.keys(event.photoCategories).length > 0
    ? Object.entries(PHOTO_CATEGORY_LABELS).flatMap(([key, label]) => {
        const photos = event.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS];
        if (!Array.isArray(photos)) return [];
        return photos
          .filter((photo): photo is string => typeof photo === 'string' && photo.trim().length > 0)
          .map(photo => ({ label, url: photo.trim() }));
      })
    : [];

  if (groupedAssets.length > 0) return groupedAssets;

  return Array.isArray(event.photos)
    ? event.photos
        .filter((photo): photo is string => typeof photo === 'string' && photo.trim().length > 0)
        .map(photo => ({ label: 'Фотографии', url: photo.trim() }))
    : [];
}

async function fetchPhotoBytes(url: string) {
  const token = getToken();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  if (url.startsWith('data:')) {
    return {
      bytes: dataUrlToBytes(url),
      mimeType: url.match(/^data:([^;]+)/)?.[1] || '',
    };
  }

  const tryReadResponse = async (response: Response) => {
    if (!response.ok) {
      throw new Error(`Не удалось получить файл: ${response.status}`);
    }
    const blob = await response.blob();
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type,
    };
  };

  const isAbsoluteHttp = /^https?:\/\//i.test(url);
  const isSameOriginAbsolute = isAbsoluteHttp && new URL(url, window.location.href).origin === window.location.origin;
  const canTryDirect = !isAbsoluteHttp || isSameOriginAbsolute || url.startsWith('blob:');

  if (canTryDirect) {
    try {
      const response = await fetch(isAbsoluteHttp ? url : new URL(url, window.location.href).toString(), {
        headers: authHeaders,
      });
      return await tryReadResponse(response);
    } catch (error) {
      if (!isAbsoluteHttp) throw error;
    }
  }

  if (isAbsoluteHttp) {
    const proxyUrl = `${API_BASE_URL}/api/media/fetch?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      headers: authHeaders,
    });
    return await tryReadResponse(response);
  }

  throw new Error('Фото недоступно для скачивания');
}

function buildShippingComparisonPairs(events: ShippingPhoto[]) {
  const chronological = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const openShippingByRental = new Map<string, ShippingPhoto[]>();
  const openShippingQueue: ShippingPhoto[] = [];
  const pairs: ShippingComparisonPair[] = [];

  chronological.forEach(event => {
    if (event.type === 'shipping') {
      if (event.rentalId) {
        const list = openShippingByRental.get(event.rentalId) || [];
        list.push(event);
        openShippingByRental.set(event.rentalId, list);
      }
      openShippingQueue.push(event);
      return;
    }

    let matchingShipping: ShippingPhoto | undefined;

    if (event.rentalId) {
      const list = openShippingByRental.get(event.rentalId) || [];
      matchingShipping = list.shift();
      if (list.length > 0) {
        openShippingByRental.set(event.rentalId, list);
      } else if (event.rentalId) {
        openShippingByRental.delete(event.rentalId);
      }
    }

    if (!matchingShipping) {
      matchingShipping = openShippingQueue.find(item => item.type === 'shipping');
    }

    if (!matchingShipping) return;

    const queueIndex = openShippingQueue.findIndex(item => item.id === matchingShipping?.id);
    if (queueIndex >= 0) {
      openShippingQueue.splice(queueIndex, 1);
    }

    pairs.push({
      id: `${matchingShipping.id}:${event.id}`,
      shipping: matchingShipping,
      receiving: event,
    });
  });

  return pairs.reverse();
}

function getComparisonLabel(pair: ShippingComparisonPair) {
  const range = `${formatDate(pair.shipping.date)} → ${formatDate(pair.receiving.date)}`;
  if (pair.shipping.rentalId) {
    return `Аренда ${pair.shipping.rentalId} · ${range}`;
  }
  return `Цикл ${range}`;
}

export default function EquipmentDetail() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canEditEquipment = can('edit', 'equipment');
  const canViewRentals = can('view', 'rentals');
  const canViewService = can('view', 'service');
  const canViewDocuments = can('view', 'documents');
  const canViewClients = can('view', 'clients');
  const canViewFinance = can('view', 'finance');
  const canCreateService = can('create', 'service');
  const canManageAcceptance = canEditEquipment || canCreateService || isMechanicRole(user?.role);
  const { id } = useParams();
  const equipmentTypeCatalog = useEquipmentTypeCatalog();

  const [allEquipment, setAllEquipment] = useState<Equipment[]>([]);
  const [allGanttRentals, setAllGanttRentals] = useState<GanttRentalData[]>([]);
  const [allServiceTickets, setAllServiceTickets] = useState<ServiceTicket[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);

  const { data: equipmentData = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: ganttData = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
    enabled: canViewRentals,
  });
  const { data: serviceData = [] } = useQuery({
    queryKey: SERVICE_TICKET_KEYS.all,
    queryFn: serviceTicketsService.getAll,
    enabled: canViewService,
  });
  const { data: paymentData = [] } = useQuery({
    queryKey: PAYMENT_KEYS.all,
    queryFn: paymentsService.getAll,
    enabled: canViewFinance,
  });
  const { data: documentData = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsService.getAll,
    enabled: canViewDocuments,
  });
  const { data: clientData = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsService.getAll,
    enabled: canViewClients,
  });
  const { data: shippingPhotoData = [] } = useQuery({
    queryKey: ['shippingPhotos', id],
    queryFn: () => equipmentService.getShippingPhotos(String(id ?? '')),
    enabled: !!id,
  });

  useEffect(() => {
    setAllEquipment(equipmentData);
  }, [equipmentData]);

  useEffect(() => {
    setAllGanttRentals(ganttData);
  }, [ganttData]);

  useEffect(() => {
    setAllServiceTickets(serviceData);
  }, [serviceData]);

  useEffect(() => {
    setAllPayments(paymentData);
  }, [paymentData]);

  const inventoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allEquipment.forEach(item => {
      counts.set(item.inventoryNumber, (counts.get(item.inventoryNumber) ?? 0) + 1);
    });
    return counts;
  }, [allEquipment]);

  // ── Find equipment (from localStorage, not empty mock) ──
  const rawEquipment = allEquipment.find(e => e.id === id);

  // ── Enrich with active rental data (currentClient / returnDate) ──
  const activeRental = rawEquipment
    ? allGanttRentals.find(r =>
        (
          (r.equipmentId && r.equipmentId === rawEquipment.id)
          || (!r.equipmentId && (inventoryCounts.get(rawEquipment.inventoryNumber) ?? 0) === 1 && r.equipmentInv === rawEquipment.inventoryNumber)
        ) &&
        (r.status === 'active' || r.status === 'created'))
    : null;

  const equipment: Equipment | null = rawEquipment ? {
    ...rawEquipment,
    currentClient: rawEquipment.currentClient || activeRental?.client,
    returnDate: rawEquipment.returnDate || activeRental?.endDate,
  } : null;

  // ── Related data (all from localStorage) ──
  const ganttRentals = useMemo(
    () => equipment ? allGanttRentals.filter(r =>
      (r.equipmentId && r.equipmentId === equipment.id)
      || (!r.equipmentId && (inventoryCounts.get(equipment.inventoryNumber) ?? 0) === 1 && r.equipmentInv === equipment.inventoryNumber)
    ).sort((a, b) => b.startDate.localeCompare(a.startDate)) : [],
    [equipment, allGanttRentals, inventoryCounts]
  );

  const serviceHistory = useMemo(
    () => equipment
      ? allServiceTickets.filter(s =>
          s.equipmentId === equipment.id ||
          (s.serialNumber && equipment.serialNumber && s.serialNumber === equipment.serialNumber) ||
          (s.inventoryNumber && (inventoryCounts.get(equipment.inventoryNumber) ?? 0) === 1 && s.inventoryNumber === equipment.inventoryNumber)
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [],
    [equipment, allServiceTickets, inventoryCounts]
  );

  const repairRecords = useMemo(() => (
    serviceHistory
      .filter(ticket => ticket.status === 'ready' || ticket.status === 'closed')
      .map(ticket => {
        const workNormHours = (ticket.resultData?.worksPerformed ?? []).reduce((sum, item) => sum + (item.totalNormHours || 0), 0);
        const partsCost = (ticket.resultData?.partsUsed ?? []).reduce((sum, item) => sum + ((item.cost || 0) * (item.qty || 0)), 0);
        return {
          id: ticket.id,
          date: ticket.closedAt || ticket.createdAt,
          type: ticket.reason?.toLowerCase().includes('то') ? 'maintenance' : 'repair',
          description: ticket.reason || 'Сервисная заявка',
          comment: ticket.resultData?.summary || ticket.description || undefined,
          mechanic: ticket.assignedMechanicName || ticket.assignedTo || 'Не назначен',
          status: ticket.status === 'closed' || ticket.status === 'ready' ? 'completed' : 'in_progress',
          source: ticket.source === 'bot' ? 'bot' : 'manual',
          cost: partsCost,
          totalNormHours: workNormHours,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  ), [serviceHistory]);

  const [allShippingPhotos, setAllShippingPhotos] = useState<ShippingPhoto[]>([]);
  useEffect(() => {
    setAllShippingPhotos(shippingPhotoData);
  }, [shippingPhotoData]);
  const shippingPhotos = useMemo(
    () => allShippingPhotos
      .filter(p => p.equipmentId === id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [allShippingPhotos, id],
  );
  const shippingComparisonPairs = useMemo(
    () => buildShippingComparisonPairs(shippingPhotos),
    [shippingPhotos],
  );
  const latestShippingEvent = useMemo(
    () => shippingPhotos.find(event => event.type === 'shipping') || null,
    [shippingPhotos],
  );
  const latestReceivingEvent = useMemo(
    () => shippingPhotos.find(event => event.type === 'receiving') || null,
    [shippingPhotos],
  );

  const persistEquipment = React.useCallback(async (list: Equipment[]) => {
    setAllEquipment(list);
    await equipmentService.bulkReplace(list);
    await queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
  }, [queryClient]);

  const persistShippingPhotos = React.useCallback(async (list: ShippingPhoto[]) => {
    setAllShippingPhotos(list);
    await equipmentService.bulkReplaceShippingPhotos(list);
    await queryClient.invalidateQueries({ queryKey: ['shippingPhotos', id] });
  }, [id, queryClient]);

  const persistGanttRentals = React.useCallback(async (list: GanttRentalData[]) => {
    setAllGanttRentals(list);
    await rentalsService.bulkReplaceGantt(list);
    await queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
  }, [queryClient]);

  // ── Photo upload state ──
  const [showUploadPhotoForm, setShowUploadPhotoForm] = useState(false);
  const [uploadEventType, setUploadEventType] = useState<'shipping' | 'receiving'>('shipping');
  const [uploadComment, setUploadComment] = useState('');
  const [uploadPhotoCategories, setUploadPhotoCategories] = useState<Partial<Record<EquipmentOperationPhotoCategory, string[]>>>(createEmptyPhotoCategories(false));
  const [uploadChecklist, setUploadChecklist] = useState(createEmptyHandoffChecklist);
  const [uploadHoursValue, setUploadHoursValue] = useState('');
  const [uploadDamageDescription, setUploadDamageDescription] = useState('');
  const [uploadSignatureDataUrl, setUploadSignatureDataUrl] = useState('');
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [isDownloadingPhotoZip, setIsDownloadingPhotoZip] = useState(false);
  const [collapsedShippingEventIds, setCollapsedShippingEventIds] = useState<string[]>([]);
  const mainPhotoInputRef = React.useRef<HTMLInputElement>(null);
  const shippingPhotoInputRefs = React.useRef<Partial<Record<EquipmentOperationPhotoCategory, HTMLInputElement | null>>>({});
  const signatureCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = React.useRef(false);

  const shippingGalleryPhotoCount = useMemo(
    () => shippingPhotos.reduce((sum, event) => {
      const categoryCount = event.photoCategories
        ? Object.values(event.photoCategories).reduce(
            (photoSum, photos) => photoSum + (Array.isArray(photos) ? photos.length : 0),
            0,
          )
        : 0;
      const flatCount = Array.isArray(event.photos) ? event.photos.length : 0;
      return sum + Math.max(categoryCount, flatCount);
    }, 0),
    [shippingPhotos],
  );

  const toggleShippingEventCollapsed = React.useCallback((eventId: string) => {
    setCollapsedShippingEventIds(current =>
      current.includes(eventId)
        ? current.filter(id => id !== eventId)
        : [...current, eventId],
    );
  }, []);

  const isShippingEventCollapsed = React.useCallback(
    (eventId: string) => collapsedShippingEventIds.includes(eventId),
    [collapsedShippingEventIds],
  );

  // Compress image to base64 (max 800px, 70% quality)
  const compressToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleMainPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditEquipment) {
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file || !equipment) return;
    const base64 = await compressToBase64(file);
    const updated = allEquipment.map(eq =>
      eq.id === equipment.id ? { ...eq, photo: base64 } : eq,
    );
    await persistEquipment(updated);
    e.target.value = '';
  };

  const handleMainPhotoDelete = () => {
    if (!equipment || !canEditEquipment) return;
    const updated = allEquipment.map(eq =>
      eq.id === equipment.id ? { ...eq, photo: undefined } : eq,
    );
    void persistEquipment(updated);
  };

  const handleShippingPhotoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const category = e.target.dataset.category as EquipmentOperationPhotoCategory | undefined;
    if (!canManageAcceptance || !category) {
      e.target.value = '';
      return;
    }
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const results = await Promise.all(files.map(f => compressToBase64(f)));
    setUploadPhotoCategories(prev => ({
      ...prev,
      [category]: [...(prev[category] ?? []), ...results],
    }));
    e.target.value = '';
  };

  const handleDownloadShippingPhotosZip = React.useCallback(async () => {
    if (!equipment || shippingPhotos.length === 0 || isDownloadingPhotoZip) return;

    setIsDownloadingPhotoZip(true);
    try {
      const zipEntries: Array<{ name: string; data: Uint8Array; date?: Date }> = [];
      const usedNames = new Set<string>();
      let skippedPhotos = 0;

      for (const event of shippingPhotos) {
        const baseFolder = `${sanitizeZipSegment(event.type === 'shipping' ? 'Отгрузка' : 'Приёмка')}_${sanitizeZipSegment(event.date || 'без-даты')}`;
        const groupedPhotos = getShippingPhotoAssets(event);

        for (let index = 0; index < groupedPhotos.length; index += 1) {
          const photo = groupedPhotos[index];
          let bytes: Uint8Array;
          let mimeType = '';

          try {
            const fileData = await fetchPhotoBytes(photo.url);
            bytes = fileData.bytes;
            mimeType = fileData.mimeType;
          } catch (error) {
            skippedPhotos += 1;
            console.warn('Skipping shipping photo in ZIP export', {
              equipmentId: equipment.id,
              eventId: event.id,
              photoUrl: photo.url,
              error,
            });
            continue;
          }

          const extension = inferPhotoExtension(photo.url, mimeType);
          const categoryLabel = sanitizeZipSegment(photo.label);
          const fileBase = `${baseFolder}/${categoryLabel}/${String(index + 1).padStart(2, '0')}`;
          let fileName = `${fileBase}.${extension}`;
          let duplicateIndex = 2;
          while (usedNames.has(fileName)) {
            fileName = `${fileBase}-${duplicateIndex}.${extension}`;
            duplicateIndex += 1;
          }
          usedNames.add(fileName);
          zipEntries.push({
            name: fileName,
            data: bytes,
            date: new Date(event.date),
          });
        }
      }

      if (zipEntries.length === 0) {
        toast.error('Не удалось собрать архив: доступных фотографий не найдено.');
        return;
      }

      const zipBlob = buildZip(zipEntries);
      const archiveName = `${sanitizeZipSegment([equipment.manufacturer, equipment.model].filter(Boolean).join(' ') || equipment.inventoryNumber || 'equipment')}-photos.zip`;
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = archiveName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(
        skippedPhotos > 0
          ? `Архив готов: ${zipEntries.length} фото, пропущено ${skippedPhotos}`
          : `Архив готов: ${zipEntries.length} фото`,
      );
    } catch (error) {
      console.error('Failed to download shipping photos zip', error);
      toast.error('Не удалось собрать ZIP-архив с фотографиями');
    } finally {
      setIsDownloadingPhotoZip(false);
    }
  }, [equipment, isDownloadingPhotoZip, shippingPhotos]);

  const activeOrCreatedRental = ganttRentals.find(r => r.status === 'active' || r.status === 'created');

  const openReceptionForm = (type: 'shipping' | 'receiving') => {
    setUploadEventType(type);
    setUploadPhotoCategories(createEmptyPhotoCategories(type === 'receiving'));
    setUploadComment('');
    setUploadChecklist(createEmptyHandoffChecklist());
    setUploadHoursValue(String(equipment?.hours ?? ''));
    setUploadDamageDescription('');
    setUploadSignatureDataUrl('');
    setShowUploadPhotoForm(true);
  };

  const clearSignatureCanvas = React.useCallback(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    setUploadSignatureDataUrl('');
  }, []);

  React.useEffect(() => {
    if (!signatureModalOpen) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    canvas.width = 520;
    canvas.height = 160;
    clearSignatureCanvas();
  }, [signatureModalOpen, clearSignatureCanvas]);

  const getSignaturePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleSignaturePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const point = getSignaturePoint(event);
    signatureDrawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const handleSignaturePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const point = getSignaturePoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const handleSignaturePointerUp = () => {
    if (!signatureDrawingRef.current) return;
    signatureDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    setUploadSignatureDataUrl(canvas.toDataURL('image/png'));
  };

  const handleShippingPhotoSave = async () => {
    const parsedHours = Number(uploadHoursValue);
    const hasRequiredPhotos = isPhotoCategoryComplete(uploadPhotoCategories, uploadEventType);
    if (
      !canManageAcceptance ||
      !equipment ||
      !isChecklistComplete(uploadChecklist) ||
      !hasRequiredPhotos ||
      !Number.isFinite(parsedHours) ||
      parsedHours < 0 ||
      !uploadSignatureDataUrl ||
      (uploadEventType === 'receiving' && !uploadDamageDescription.trim())
    ) return;
    const authorName = user?.name || 'Сотрудник';
    const todayStr = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();
    const flatPhotos = Object.values(uploadPhotoCategories).flat();
    const newEvent: ShippingPhoto = {
      id: `sp-${Date.now()}`,
      equipmentId: equipment.id,
      date: todayStr,
      type: uploadEventType,
      uploadedBy: authorName,
      photos: flatPhotos,
      comment: uploadComment || undefined,
      rentalId: activeOrCreatedRental?.id,
      source: 'manual',
      checklist: uploadChecklist,
      photoCategories: uploadPhotoCategories,
      hoursValue: parsedHours,
      damageDescription: uploadEventType === 'receiving' ? uploadDamageDescription.trim() : undefined,
      signedBy: authorName,
      signedAt: nowIso,
      signatureDataUrl: uploadSignatureDataUrl,
    };

    const updatedPhotos = [...allShippingPhotos, newEvent];

    const updatedEquipment = allEquipment.map(eq => {
      if (eq.id !== equipment.id) return eq;

      if (uploadEventType === 'shipping') {
        return appendAuditHistory(
          {
            ...eq,
            status: 'rented' as const,
            currentClient: activeOrCreatedRental?.client || eq.currentClient,
            returnDate: activeOrCreatedRental?.endDate || eq.returnDate,
            hours: parsedHours,
          },
          createAuditEntry(
            authorName,
            `Техника отгружена в аренду${activeOrCreatedRental?.client ? ` клиенту ${activeOrCreatedRental.client}` : ''}. Добавлен акт отправки (${flatPhotos.length} фото, ${parsedHours} м/ч)`,
          ),
        );
      }

      return appendAuditHistory(
        {
          ...eq,
          status: 'in_service' as const,
          currentClient: undefined,
          returnDate: undefined,
          hours: parsedHours,
        },
        createAuditEntry(
          authorName,
          `Техника принята с аренды и переведена в сервис. Добавлен акт приёмки (${flatPhotos.length} фото, ${parsedHours} м/ч${uploadDamageDescription.trim() ? ', повреждения зафиксированы' : ''})`,
        ),
      );
    });

    const updatedGantt = allGanttRentals.map(rental => {
      if (rental.equipmentId !== equipment.id || rental.id !== activeOrCreatedRental?.id) return rental;

      if (uploadEventType === 'shipping' && rental.status === 'created') {
        return {
          ...rental,
          status: 'active' as const,
          comments: [
            ...(rental.comments ?? []),
            { date: nowIso, text: 'Техника отгружена клиенту, добавлен фотоотчёт отправки', author: authorName },
          ],
        };
      }

      if (uploadEventType === 'receiving' && (rental.status === 'active' || rental.status === 'created')) {
        return {
          ...rental,
          status: 'returned' as const,
          endDate: todayStr,
          comments: [
            ...(rental.comments ?? []),
            { date: nowIso, text: 'Техника принята с аренды, добавлен фотоотчёт приёмки', author: authorName },
          ],
        };
      }

      return rental;
    });

    await persistShippingPhotos(updatedPhotos);
    await persistEquipment(updatedEquipment);
    await persistGanttRentals(updatedGantt);

    if (uploadEventType === 'receiving') {
      const hasOpenTicket = serviceHistory.some(ticket => ticket.status !== 'closed');
      if (!hasOpenTicket) {
        await serviceTicketsService.create({
          equipmentId: equipment.id,
          equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
          inventoryNumber: equipment.inventoryNumber,
          serialNumber: equipment.serialNumber,
          equipmentType: equipment.type,
          equipmentTypeLabel: findEquipmentTypeLabel(equipment.type, equipmentTypeCatalog),
          location: equipment.location,
          reason: 'Приёмка с аренды',
          description: uploadComment?.trim()
            ? `Техника принята с аренды. Комментарий механика: ${uploadComment.trim()}${uploadDamageDescription.trim() ? ` Повреждения: ${uploadDamageDescription.trim()}` : ''}`
            : `Техника принята с аренды, требуется осмотр и дефектовка после возврата.${uploadDamageDescription.trim() ? ` Повреждения: ${uploadDamageDescription.trim()}` : ''}`,
          priority: 'medium',
          sla: '24 ч',
          assignedTo: undefined,
          assignedMechanicId: undefined,
          assignedMechanicName: undefined,
          createdBy: authorName,
          createdByUserId: user?.id,
          createdByUserName: authorName,
          reporterContact: activeOrCreatedRental?.client || authorName,
          source: 'system',
          status: 'new',
          result: undefined,
          resultData: {
            summary: '',
            partsUsed: [],
            worksPerformed: [],
          },
          workLog: [
            {
              date: nowIso,
              text: 'Заявка автоматически создана после приёмки техники с аренды',
              author: authorName,
              type: 'status_change',
            },
          ],
          parts: [],
          createdAt: nowIso,
          photos: flatPhotos,
        });
        await queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all });
        await queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.byEquipment(equipment.id) });

        const equipmentWithServiceHistory = updatedEquipment.map(eq =>
          eq.id === equipment.id
            ? appendAuditHistory(
                eq,
                createAuditEntry(
                  authorName,
                  'Автоматически создана сервисная заявка после приёмки с аренды',
                ),
              )
            : eq,
        );
        await persistEquipment(equipmentWithServiceHistory);
      }
    }

    setUploadPhotoCategories(createEmptyPhotoCategories(uploadEventType === 'receiving'));
    setUploadComment('');
    setUploadChecklist(createEmptyHandoffChecklist());
    setUploadHoursValue('');
    setUploadDamageDescription('');
    setUploadSignatureDataUrl('');
    setShowUploadPhotoForm(false);
  };

  // ── Modal state ──
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateServiceModal, setShowCreateServiceModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedComparisonPairId, setSelectedComparisonPairId] = useState('');
  const comparisonSectionRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedComparisonPairId(currentId => {
      if (shippingComparisonPairs.length === 0) return '';
      if (shippingComparisonPairs.some(pair => pair.id === currentId)) return currentId;
      return shippingComparisonPairs[0].id;
    });
  }, [shippingComparisonPairs]);

  const selectedComparisonPair = useMemo(
    () => shippingComparisonPairs.find(pair => pair.id === selectedComparisonPairId) || shippingComparisonPairs[0] || null,
    [selectedComparisonPairId, shippingComparisonPairs],
  );

  const selectedComparisonGroups = useMemo(() => {
    if (!selectedComparisonPair) return [];

    const beforeGroups = new Map(getShippingPhotoGroups(selectedComparisonPair.shipping).map(group => [group.key, group] as const));
    const afterGroups = new Map(getShippingPhotoGroups(selectedComparisonPair.receiving).map(group => [group.key, group] as const));
    const orderedKeys = [...Object.keys(PHOTO_CATEGORY_LABELS), 'generic'];

    return orderedKeys
      .filter(key => beforeGroups.has(key) || afterGroups.has(key))
      .map(key => ({
        key,
        label: beforeGroups.get(key)?.label || afterGroups.get(key)?.label || 'Фотографии',
        beforePhotos: beforeGroups.get(key)?.photos || [],
        afterPhotos: afterGroups.get(key)?.photos || [],
      }));
  }, [selectedComparisonPair]);

  const scrollToComparisonSection = React.useCallback(() => {
    comparisonSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  // ── Not found screen ──
  if (!equipment) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            <AlertTriangle className="h-8 w-8 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Техника не найдена</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Запись с ID <span className="font-mono">{id}</span> не существует или была удалена
          </p>
          <Link to="/equipment" className="mt-6 inline-flex items-center gap-2 text-[--color-primary] hover:underline">
            <ArrowLeft className="h-4 w-4" />
            Вернуться к списку
          </Link>
        </div>
      </div>
    );
  }

  // ── Financial calculations (current month, dynamic) ──
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysInCurrentMonth = getDaysInMonth(today);
  const currentMonthLabel = format(today, 'LLLL yyyy', { locale: ru });
  const monthStartStr = format(monthStart, 'yyyy-MM-dd');
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

  const monthRentals = ganttRentals.filter(r => {
    return r.startDate <= monthEndStr && r.endDate >= monthStartStr;
  });

  const daysRentedThisMonth = monthRentals.reduce((sum, r) => {
    return sum + getRentalOverlapDays(r.startDate, r.endDate, monthStartStr, monthEndStr);
  }, 0);

  const freeDaysThisMonth = daysInCurrentMonth - Math.min(daysRentedThisMonth, daysInCurrentMonth);
  const utilizationMonth = Math.round((Math.min(daysRentedThisMonth, daysInCurrentMonth) / daysInCurrentMonth) * 100);

  const actualMonthRevenue = monthRentals.reduce((sum, r) => {
    const rentalDays = getRentalDays(r.startDate, r.endDate);
    if (rentalDays <= 0) return sum;
    const dailyRate = r.amount / rentalDays;
    const daysInPeriod = getRentalOverlapDays(r.startDate, r.endDate, monthStartStr, monthEndStr);
    return sum + dailyRate * daysInPeriod;
  }, 0);

  const totalRevenue = ganttRentals
    .filter(r => r.status === 'returned' || r.status === 'closed' || r.status === 'active')
    .reduce((sum, r) => sum + r.amount, 0);

  // ── Manager commission calculation ──
  const getManagerCommission = () => {
    if (equipment.owner === 'own') {
      return { rate: '3%', commission: Math.round(actualMonthRevenue * 0.03), formula: `${formatCurrency(actualMonthRevenue)} × 3%` };
    }
    if (equipment.owner === 'investor') {
      const margin = actualMonthRevenue * 0.4;
      return { rate: '7% от 40%', commission: Math.round(margin * 0.07), formula: `${formatCurrency(actualMonthRevenue)} × 40% = ${formatCurrency(margin)}, × 7%` };
    }
    if (equipment.owner === 'sublease') {
      const profit = actualMonthRevenue - (equipment.subleasePrice || 0);
      return { rate: 'от разницы', commission: Math.max(profit, 0), formula: `${formatCurrency(actualMonthRevenue)} − ${formatCurrency(equipment.subleasePrice || 0)}` };
    }
    return { rate: '—', commission: 0, formula: '' };
  };
  const managerComm = getManagerCommission();

  // ── Maintenance alerts ──
  const daysUntilMaintenance = getDaysUntil(equipment.nextMaintenance);
  const openServiceTickets = serviceHistory.filter(s => s.status !== 'closed');
  const criticalTickets = openServiceTickets.filter(s => s.priority === 'critical' || s.priority === 'high');

  // ── Payments for equipment rentals ──
  const equipmentRentalIds = new Set(ganttRentals.map(r => r.id));
  const equipmentPayments = allPayments.filter(p => p.rentalId && equipmentRentalIds.has(p.rentalId));
  const totalPaidRevenue = equipmentPayments.reduce((sum, p) => sum + (p.paidAmount ?? p.amount), 0);
  const equipment360 = buildEquipment360Summary({
    equipment,
    rentals: canViewRentals ? allGanttRentals : [],
    serviceTickets: canViewService ? allServiceTickets : [],
    documents: canViewDocuments ? documentData : [],
    payments: canViewFinance ? allPayments : [],
    clients: canViewClients ? clientData : [],
    inventoryIsUnique: (inventoryCounts.get(equipment.inventoryNumber) ?? 0) === 1,
    utilizationPercent: utilizationMonth,
  });
  const quickActions = buildEquipmentQuickActions({
    equipment,
    can,
    currentRental: equipment360.occupancy.currentRental,
  });

  const tabTriggerClass = 'whitespace-nowrap';

  return (
    <div className="equipment-detail-skin space-y-5 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`border-0 ${
                equipment.priority === 'critical' || equipment.priority === 'high'
                  ? 'bg-red-500/12 text-red-300'
                  : equipment.priority === 'medium'
                  ? 'bg-blue-500/12 text-blue-300'
                  : 'bg-emerald-500/12 text-emerald-300'
              }`}>
                {EQUIPMENT_PRIORITY_LABELS[equipment.priority]}
              </Badge>
              <Badge className={`border-0 ${
                equipment.status === 'in_service'
                  ? 'bg-orange-500/12 text-orange-300'
                  : equipment.status === 'rented'
                  ? 'bg-blue-500/12 text-blue-300'
                  : equipment.status === 'reserved'
                  ? 'bg-yellow-500/12 text-yellow-300'
                  : 'bg-emerald-500/12 text-emerald-300'
              }`}>
                {EQ_STATUS_LABELS[equipment.status]}
              </Badge>
              <Badge className={`border-0 ${
                equipment.owner === 'own'
                  ? 'bg-emerald-500/12 text-emerald-300'
                  : equipment.owner === 'investor'
                  ? 'bg-blue-500/12 text-blue-300'
                  : 'bg-orange-500/12 text-orange-300'
              }`}>
                {ownerLabels[equipment.owner]}
              </Badge>
              {equipment.isForSale && (
                <Badge className="border-0 bg-orange-500/12 text-orange-300">
                  На продажу
                </Badge>
              )}
            </div>
            <h1 className="app-shell-title mt-3 text-3xl font-extrabold text-foreground sm:text-4xl">
              {equipment.manufacturer} {equipment.model}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Инв. № {equipment.inventoryNumber || '—'} · SN {equipment.serialNumber || 'не указан'}
            </p>
            <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {equipment.location || 'Локация не указана'}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {can('edit', 'equipment') && (
              <Button variant="secondary" size="sm" className="app-button-ghost rounded-xl px-4" onClick={() => setShowEditModal(true)}>
                Редактировать
              </Button>
            )}
            {canViewRentals && (
              <Link to="/rentals">
                <Button variant="secondary" size="sm" className="app-button-outline rounded-xl px-4">
                  <Calendar className="h-3.5 w-3.5" />
                  Аренды
                </Button>
              </Link>
            )}
            {canViewService && (
              <Link to="/service">
                <Button size="sm" className="app-button-primary rounded-xl px-4">
                  <Wrench className="h-3.5 w-3.5" />
                  В сервис
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-2xl border p-4 ${
          equipment.isForSale
            ? equipment.salePdiStatus === 'ready'
              ? 'border-emerald-500/25 bg-emerald-500/8'
              : equipment.salePdiStatus === 'in_progress'
              ? 'border-orange-500/25 bg-orange-500/8'
              : 'border-border bg-card/95'
            : equipment.status === 'in_service'
            ? 'border-red-500/25 bg-red-500/8'
            : equipment.status === 'reserved'
            ? 'border-orange-500/25 bg-orange-500/8'
            : equipment.status === 'rented'
            ? 'border-blue-500/25 bg-blue-500/8'
            : 'border-border bg-card/95'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Статус</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {equipment.isForSale
                  ? (equipment.salePdiStatus === 'ready' ? 'PDI готов' : 'PDI не готов')
                  : EQ_STATUS_LABELS[equipment.status]}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {equipment.isForSale
                  ? EQUIPMENT_SALE_PDI_LABELS[equipment.salePdiStatus ?? 'not_started']
                  : (equipment.currentClient || 'Техника без активного клиента')}
              </p>
            </div>
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${
          equipment.isForSale
            ? 'border-border bg-card/95'
            : daysUntilMaintenance <= 7
            ? 'border-red-500/25 bg-red-500/8'
            : daysUntilMaintenance <= 30
            ? 'border-orange-500/25 bg-orange-500/8'
            : 'border-border bg-card/95'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {equipment.isForSale ? 'Продажный контур' : 'Следующее ТО'}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {equipment.isForSale ? 'На продаже' : formatDate(equipment.nextMaintenance)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {equipment.isForSale
                  ? 'Карточка адаптирована под продажу и готовность PDI'
                  : (daysUntilMaintenance > 0 ? `через ${daysUntilMaintenance} дн.` : 'просрочено')}
              </p>
            </div>
            <Wrench className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/95 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Утилизация · {format(today, 'MMM', { locale: ru })}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{utilizationMonth}%</p>
              <p className="mt-1 text-xs text-muted-foreground">{daysRentedThisMonth} из {daysInCurrentMonth} дней</p>
            </div>
            <TrendingUp className="h-5 w-5 text-blue-300" />
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${utilizationMonth}%` }} />
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${
          criticalTickets.length > 0
            ? 'border-red-500/25 bg-red-500/8'
            : openServiceTickets.length > 0
            ? 'border-orange-500/25 bg-orange-500/8'
            : 'border-border bg-card/95'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Сервисные заявки</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {openServiceTickets.length > 0 ? `${openServiceTickets.length} открыт.` : 'Нет заявок'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">всего {serviceHistory.length} в истории</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {!equipment.isForSale && daysUntilMaintenance <= 30 && (
        <div className={`rounded-2xl border px-4 py-3 ${
          daysUntilMaintenance <= 7
            ? 'border-red-500/25 bg-red-500/8'
            : 'border-orange-500/25 bg-orange-500/8'
        }`}>
          <div className="flex items-start gap-3">
            <CircleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${daysUntilMaintenance <= 7 ? 'text-red-300' : 'text-orange-300'}`} />
            <div className="flex-1">
              <p className={`font-medium ${daysUntilMaintenance <= 7 ? 'text-red-300' : 'text-orange-300'}`}>
                Техническое обслуживание через {daysUntilMaintenance} дней
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Запланировано на {formatDate(equipment.nextMaintenance)}
              </p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Техника 360°</CardTitle>
              <CardDescription>Сводка по занятости, сервису, документам и рискам без изменения данных</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canViewRentals && (
                <Link to="/rentals">
                  <Button size="sm" variant="secondary"><Calendar className="h-4 w-4" /> Аренды</Button>
                </Link>
              )}
              {canViewService && (
                <Link to="/service">
                  <Button size="sm" variant="secondary"><Wrench className="h-4 w-4" /> Сервис</Button>
                </Link>
              )}
              {canViewDocuments && (
                <Link to="/documents">
                  <Button size="sm" variant="secondary"><FileText className="h-4 w-4" /> Документы</Button>
                </Link>
              )}
              {canViewClients && equipment360.occupancy.currentRental?.clientId && (
                <Link to={`/clients/${equipment360.occupancy.currentRental.clientId}`}>
                  <Button size="sm" variant="secondary"><User className="h-4 w-4" /> Клиент</Button>
                </Link>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <CompactMetric label="Статус" value={equipment360.occupancy.label} tone={equipment360.flags.length > 0 ? 'warning' : 'default'} />
            <CompactMetric label="Собственник" value={equipment.ownerName || ownerLabels[equipment.owner] || 'Не указан'} />
            <CompactMetric label="Локация" value={equipment.location || 'Не указана'} />
            <CompactMetric label="Простой" value={equipment360.downtime.label} tone={equipment360.downtime.reason === 'service' ? 'danger' : 'default'} />
          </div>

          {quickActions.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-card/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Быстрые действия</p>
              <div className="flex flex-wrap gap-2">
                {quickActions.map(action => {
                  const button = (
                    <Button
                      size="sm"
                      variant={action.kind === 'primary' ? 'default' : 'secondary'}
                      disabled={action.disabled}
                      title={action.reason || undefined}
                    >
                      {action.id === 'equipment-create-service' && <Wrench className="h-4 w-4" />}
                      {action.id === 'equipment-create-rental' && <Calendar className="h-4 w-4" />}
                      {action.label}
                    </Button>
                  );
                  return action.disabled || !action.to
                    ? <span key={action.id}>{button}</span>
                    : <Link key={action.id} to={action.to}>{button}</Link>;
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-border bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Текущая занятость</h3>
                {equipment360.occupancy.overdueReturn && <Badge variant="error">Просрочен возврат</Badge>}
              </div>
              {equipment360.occupancy.currentRental ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-foreground">{equipment360.occupancy.currentRental.client}</p>
                  <p className="text-muted-foreground">
                    {formatDate(equipment360.occupancy.currentRental.startDate)} — {formatDate(equipment360.occupancy.currentRental.endDate)}
                  </p>
                  <p className="text-muted-foreground">Менеджер: {equipment360.occupancy.currentRental.manager}</p>
                  {canViewRentals && (
                    <Link to={`/rentals/${equipment360.occupancy.currentRental.id}`} className="inline-flex items-center gap-1 text-xs text-[--color-primary] hover:underline">
                      Открыть аренду <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{equipment360.occupancy.label}</p>
              )}
              {equipment360.occupancy.nextRental && (
                <div className="mt-3 rounded-lg border border-border bg-secondary/50 p-3 text-sm">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Ближайшая будущая аренда</p>
                  <p className="mt-1 font-medium text-foreground">{equipment360.occupancy.nextRental.client}</p>
                  <p className="text-muted-foreground">{formatDate(equipment360.occupancy.nextRental.startDate)} — {formatDate(equipment360.occupancy.nextRental.endDate)}</p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Сервис и готовность</h3>
                <Badge variant={equipment360.service.open.length > 0 ? 'warning' : 'default'}>{equipment360.service.open.length} открыто</Badge>
              </div>
              {canViewService ? (
                equipment360.service.open.length > 0 ? (
                  <div className="space-y-2">
                    {equipment360.service.open.slice(0, 3).map(ticket => (
                      <LinkedRow
                        key={ticket.id}
                        title={ticket.reason}
                        meta={`${ticket.statusLabel} · ${ticket.mechanic}${ticket.waitingParts ? ' · ждёт запчасти' : ''}`}
                        href={`/service/${ticket.id}`}
                        canOpen={canViewService}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Открытых сервисных заявок нет.</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">Раздел сервиса недоступен для этой роли.</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Красные флаги</h3>
                <Badge variant={equipment360.flags.length > 0 ? 'error' : 'success'}>{equipment360.flags.length}</Badge>
              </div>
              {equipment360.flags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {equipment360.flags.slice(0, 8).map(flag => (
                    <Badge key={flag.id} variant={flag.severity === 'high' ? 'error' : 'warning'}>{flag.label}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Критичных сигналов по доступным данным нет.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <CompactList
              title="Арендная история"
              emptyText={canViewRentals ? 'Аренд по технике нет.' : 'Раздел аренд недоступен для этой роли.'}
              items={canViewRentals ? equipment360.rentals.latest.slice(0, 5).map(rental => ({
                id: rental.id,
                title: rental.client,
                meta: `${formatDate(rental.startDate)} — ${formatDate(rental.endDate)} · ${rental.statusLabel} · ${rental.manager}`,
                href: `/rentals/${rental.id}`,
              })) : []}
              canOpen={canViewRentals}
            />
            <CompactList
              title="Документы техники"
              emptyText={canViewDocuments ? 'Связанных документов нет.' : 'Раздел документов недоступен для этой роли.'}
              items={canViewDocuments ? equipment360.documents.latest.slice(0, 5).map(doc => ({
                id: doc.id,
                title: `${doc.type} ${doc.id ? `· ${doc.id}` : ''}`,
                meta: `${formatDate(doc.date)} · ${doc.status}`,
                href: '/documents',
              })) : []}
              canOpen={canViewDocuments}
            />
            {canViewFinance ? (
              <div className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Финансы по технике</h3>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <CompactMetric label="Выручка по арендам" value={formatCurrency(equipment360.finance.revenue)} tone="success" />
                  <CompactMetric label="Задолженность по арендам" value={formatCurrency(equipment360.finance.outstanding)} tone={equipment360.finance.outstanding > 0 ? 'danger' : 'default'} />
                  <CompactMetric label="Количество аренд" value={String(equipment360.finance.rentalCount)} />
                  <CompactMetric label="Средняя длительность" value={equipment360.finance.averageDurationDays > 0 ? `${equipment360.finance.averageDurationDays} дн.` : 'Нет данных'} />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card/70 p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Финансы по технике</h3>
                <p className="text-sm text-muted-foreground">Финансовые показатели скрыты правами доступа.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardContent className="p-0">
            <input
              ref={mainPhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleMainPhotoUpload}
            />
            <div className="group relative">
              {equipment.photo ? (
                <div className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-2xl bg-secondary p-3">
                  <img
                    src={equipment.photo}
                    alt={equipment.model}
                    className="max-h-[32rem] w-full cursor-zoom-in rounded-xl object-contain"
                    onClick={() => setPreviewImage(equipment.photo ?? null)}
                  />
                </div>
              ) : (
                <div className="flex min-h-[18rem] items-center justify-center rounded-2xl bg-secondary">
                  <ImageIcon className="h-16 w-16 text-muted-foreground" />
                </div>
              )}
              {canEditEquipment && (
                <div className="absolute inset-0 hidden items-end justify-center rounded-2xl bg-black/0 pb-3 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100 sm:flex">
                  <div className="flex gap-2">
                    <button
                      onClick={() => mainPhotoInputRef.current?.click()}
                      className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-900 shadow"
                    >
                      {equipment.photo ? 'Заменить' : 'Загрузить'}
                    </button>
                    {equipment.photo && (
                      <button
                        onClick={handleMainPhotoDelete}
                        className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-red-600 shadow"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {canEditEquipment && (
              <div className="flex gap-2 px-3 py-2 sm:hidden">
                <button
                  onClick={() => mainPhotoInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-foreground"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {equipment.photo ? 'Заменить фото' : 'Загрузить фото'}
                </button>
                {equipment.photo && (
                  <button
                    onClick={handleMainPhotoDelete}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </button>
                )}
              </div>
            )}
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">
              {equipment.photo ? 'Фото загружено' : 'Нет фотографий · нажмите чтобы добавить'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Основные характеристики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <InfoField label="Производитель" value={equipment.manufacturer} />
              <InfoField label="Модель" value={equipment.model} />
              <InfoField label="Тип" value={findEquipmentTypeLabel(equipment.type, equipmentTypeCatalog)} />
              <InfoField label="Приоритет" value={EQUIPMENT_PRIORITY_LABELS[equipment.priority]} />
              <InfoField label="Привод" value={equipment.drive === 'diesel' ? 'Дизель' : 'Электро'} />
              <InfoField label="Серийный номер" value={equipment.serialNumber} mono />
              <InfoField label="Инвентарный номер" value={equipment.inventoryNumber} mono />
              <InfoField label="Год выпуска" value={String(equipment.year)} />
              {!equipment.isForSale && <InfoField label="Моточасы" value={`${equipment.hours} ч`} />}
              <InfoField label="Высота подъёма" value={`${equipment.liftHeight} м`} />
              {equipment.workingHeight && <InfoField label="Рабочая высота" value={`${equipment.workingHeight} м`} />}
              {equipment.loadCapacity && <InfoField label="Грузоподъёмность" value={`${equipment.loadCapacity} кг`} />}
              {equipment.dimensions && <InfoField label="Габариты" value={equipment.dimensions} />}
              {equipment.weight && <InfoField label="Масса" value={`${equipment.weight} кг`} />}
              <InfoField label="Локация" value={equipment.location || '—'} />
              <InfoField label="Владелец" value={ownerLabels[equipment.owner]} />
              {canViewFinance && equipment.owner === 'sublease' && equipment.subleasePrice && (
                <InfoField label="Стоимость субаренды" value={`${formatCurrency(equipment.subleasePrice)}/мес`} highlight="orange" />
              )}
              {!equipment.isForSale && (
                <InfoField label="След. ТО" value={formatDate(equipment.nextMaintenance)} highlight={daysUntilMaintenance <= 0 ? 'red' : undefined} />
              )}
            </div>

            {equipment.currentClient && (
              <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/8 p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <InfoField label="Текущий клиент" value={equipment.currentClient} />
                  {activeRental?.startDate && (
                    <InfoField label="Начало аренды" value={formatDate(activeRental.startDate)} />
                  )}
                  {equipment.returnDate && (
                    <InfoField label="Плановый возврат" value={formatDate(equipment.returnDate)} />
                  )}
                  {activeRental?.manager && (
                    <InfoField label="Менеджер" value={activeRental.manager} />
                  )}
                  {canViewFinance && activeRental?.amount && (
                    <InfoField label="Сумма аренды" value={formatCurrency(activeRental.amount)} />
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-cyan-300">GSM</p>
                  <p className="text-xs text-muted-foreground">Привязка трекера и последняя телеметрия</p>
                </div>
                <Badge
                  variant={
                    equipment.gsmStatus === 'online' || equipment.gsmSignalStatus === 'online'
                      ? 'success'
                      : equipment.gsmStatus === 'offline' || equipment.gsmSignalStatus === 'offline'
                      ? 'warning'
                      : 'default'
                  }
                >
                  {equipment.gsmStatus === 'online' || equipment.gsmSignalStatus === 'online'
                    ? 'Онлайн'
                    : equipment.gsmStatus === 'offline' || equipment.gsmSignalStatus === 'offline'
                    ? 'Офлайн'
                    : 'Неизвестно'}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <InfoField label="GSM IMEI" value={equipment.gsmImei || '—'} mono />
                <InfoField label="Device ID" value={equipment.gsmDeviceId || equipment.gsmTrackerId || '—'} mono />
                <InfoField label="SIM-карта" value={equipment.gsmSimNumber || '—'} />
                <InfoField label="Протокол" value={equipment.gsmProtocol || '—'} />
                <InfoField
                  label="Последняя связь"
                  value={equipment.gsmLastSeenAt || equipment.gsmLastSignalAt ? formatDateTime(equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || '') : '—'}
                />
                <InfoField
                  label="Координаты"
                  value={
                    typeof (equipment.gsmLastLat ?? equipment.gsmLatitude) === 'number'
                    && typeof (equipment.gsmLastLng ?? equipment.gsmLongitude) === 'number'
                      ? `${(equipment.gsmLastLat ?? equipment.gsmLatitude)!.toFixed(5)}, ${(equipment.gsmLastLng ?? equipment.gsmLongitude)!.toFixed(5)}`
                      : '—'
                  }
                />
                <InfoField label="Напряжение" value={typeof (equipment.gsmLastVoltage ?? equipment.gsmBatteryVoltage) === 'number' ? `${(equipment.gsmLastVoltage ?? equipment.gsmBatteryVoltage)!.toFixed(1)} В` : '—'} />
                <InfoField label="Моточасы" value={typeof (equipment.gsmLastMotoHours ?? equipment.gsmHourmeter) === 'number' ? `${(equipment.gsmLastMotoHours ?? equipment.gsmHourmeter)!.toLocaleString('ru-RU')} м/ч` : '—'} />
              </div>
            </div>

            {equipment.isForSale && (
              <div className="mt-4 rounded-xl border border-orange-500/20 bg-orange-500/8 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-orange-300">Продажа</p>
                    <p className="text-xs text-muted-foreground">Коммерческий контур и готовность PDI</p>
                  </div>
                  <Badge className={`border-0 ${
                    equipment.salePdiStatus === 'ready'
                      ? 'bg-emerald-500/12 text-emerald-300'
                      : equipment.salePdiStatus === 'in_progress'
                      ? 'bg-orange-500/12 text-orange-300'
                      : 'bg-secondary text-muted-foreground'
                  }`}>
                    {EQUIPMENT_SALE_PDI_LABELS[equipment.salePdiStatus ?? 'not_started']}
                  </Badge>
                </div>
                {canViewFinance ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InfoField label="Цена 1" value={formatCurrency(equipment.salePrice1 ?? 0)} />
                    <InfoField label="Цена 2" value={formatCurrency(equipment.salePrice2 ?? 0)} />
                    <InfoField label="Цена 3" value={formatCurrency(equipment.salePrice3 ?? 0)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Финансовые параметры продажи скрыты правами доступа.</p>
                )}
              </div>
            )}

            {!equipment.isForSale && (
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
                <InfoField label="След. ТО" value={formatDate(equipment.nextMaintenance)} />
                {equipment.maintenanceCHTO && <InfoField label="Дата ЧТО" value={formatDate(equipment.maintenanceCHTO)} />}
                {equipment.maintenancePTO && <InfoField label="Дата ПТО" value={formatDate(equipment.maintenancePTO)} />}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="">
          <TabsTrigger value="overview" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Обзор</span>
          </TabsTrigger>
          {canViewFinance && (
            <TabsTrigger value="financial" className={tabTriggerClass}>
              <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Финансы</span>
            </TabsTrigger>
          )}
          {canViewRentals && (
            <TabsTrigger value="rental-history" className={tabTriggerClass}>
              <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Аренды {ganttRentals.length > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">{ganttRentals.length}</span>}</span>
            </TabsTrigger>
          )}
          {canViewService && (
            <TabsTrigger value="service-history" className={tabTriggerClass}>
              <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Сервис {openServiceTickets.length > 0 && <span className="rounded-full bg-red-500/12 px-1.5 text-xs text-red-300">{openServiceTickets.length}</span>}</span>
            </TabsTrigger>
          )}
          {canViewService && (
            <TabsTrigger value="repair-history" className={tabTriggerClass}>
              <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Ремонты</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="photos" className={tabTriggerClass}>
            <span className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Фото</span>
          </TabsTrigger>
          {canViewDocuments && (
            <TabsTrigger value="documents" className={tabTriggerClass}>
              <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Документы</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ══ OVERVIEW TAB ══ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Rental block */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[--color-primary]" />
                    Аренда
                  </CardTitle>
                  <Link to="/rentals" className="flex items-center gap-1 text-xs text-[--color-primary] hover:underline">
                    Открыть планировщик <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border bg-secondary/70 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Статус аренды</p>
                    <p className="mt-1 font-medium text-foreground">{EQ_STATUS_LABELS[equipment.status]}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/70 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Всего аренд</p>
                    <p className="mt-1 font-medium text-foreground">{ganttRentals.length}</p>
                  </div>
                  {equipment.currentClient ? (
                    <>
                      <div className="col-span-2 rounded-xl border border-blue-500/20 bg-blue-500/10 p-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-blue-200/80">Текущий клиент</p>
                        <p className="mt-1 font-medium text-foreground">{equipment.currentClient}</p>
                        {equipment.returnDate && (
                          <p className="mt-0.5 text-xs text-blue-300">
                            Возврат: {formatDate(equipment.returnDate)}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <p className="text-sm font-medium text-emerald-300">Техника свободна</p>
                      {ganttRentals.some(r => r.status === 'created' && r.startDate > format(today, 'yyyy-MM-dd')) && (
                        <p className="mt-0.5 text-xs text-emerald-200/80">
                          Есть предстоящая бронь
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Last 3 rentals */}
                {ganttRentals.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Последние аренды</p>
                    <div className="space-y-1.5">
                      {ganttRentals.slice(0, 3).map(r => (
                        <div key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/60 px-3 py-2">
                          <div>
                            <span className="text-sm text-foreground">{r.client}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {formatDate(r.startDate)} — {formatDate(r.endDate)}
                            </span>
                          </div>
                          <Badge variant={r.status === 'active' ? 'info' : r.status === 'returned' || r.status === 'closed' ? 'default' : 'warning'} >
                            {r.status === 'active' ? 'Активна' : r.status === 'returned' ? 'Возвр.' : r.status === 'closed' ? 'Закр.' : 'Бронь'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service block */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-[--color-primary]" />
                    Сервис
                  </CardTitle>
                  <Link to="/service" className="flex items-center gap-1 text-xs text-[--color-primary] hover:underline">
                    Открыть сервис <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-xl border p-3 ${
                    daysUntilMaintenance <= 7
                      ? 'border-red-500/20 bg-red-500/10'
                      : daysUntilMaintenance <= 30
                      ? 'border-orange-500/20 bg-orange-500/10'
                      : 'border-border bg-secondary/70'
                  }`}>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Следующее ТО</p>
                    <p className={`mt-1 font-medium ${
                      daysUntilMaintenance <= 7
                        ? 'text-red-300'
                        : daysUntilMaintenance <= 30
                        ? 'text-orange-300'
                        : 'text-foreground'
                    }`}>
                      {formatDate(equipment.nextMaintenance)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {daysUntilMaintenance > 0 ? `через ${daysUntilMaintenance} дн.` : 'просрочено'}
                    </p>
                  </div>
                  {equipment.maintenanceCHTO && (
                    <div className="rounded-xl border border-border bg-secondary/70 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">ЧТО</p>
                      <p className="mt-1 font-medium text-foreground">{formatDate(equipment.maintenanceCHTO)}</p>
                    </div>
                  )}
                  {equipment.maintenancePTO && (
                    <div className="rounded-xl border border-border bg-secondary/70 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">ПТО</p>
                      <p className="mt-1 font-medium text-foreground">{formatDate(equipment.maintenancePTO)}</p>
                    </div>
                  )}
                  <div className={`rounded-xl border p-3 ${
                    openServiceTickets.length > 0
                      ? 'border-orange-500/20 bg-orange-500/10'
                      : 'border-border bg-secondary/70'
                  }`}>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Открытых заявок</p>
                    <p className={`mt-1 font-medium ${openServiceTickets.length > 0 ? 'text-orange-300' : 'text-foreground'}`}>
                      {openServiceTickets.length}
                    </p>
                  </div>
                </div>

                {openServiceTickets.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Открытые заявки</p>
                    <div className="space-y-1.5">
                      {openServiceTickets.slice(0, 3).map(t => (
                        <div key={t.id} className="flex items-center justify-between rounded-xl border border-border bg-secondary/60 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className="truncate text-sm text-foreground">{t.reason}</span>
                          </div>
                          <Badge variant={t.priority === 'critical' ? 'error' : t.priority === 'high' ? 'warning' : 'info'}>
                            {t.priority === 'critical' ? 'Критич.' : t.priority === 'high' ? 'Высокий' : SERVICE_STATUS_LABELS[t.status]}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Economics summary */}
          {canViewFinance && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-[--color-primary]" />
                  Экономика
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-blue-200/80">Плановый доход/мес</p>
                    <p className="mt-1 text-lg font-semibold text-blue-300">{formatCurrency(equipment.plannedMonthlyRevenue)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-emerald-200/80">Факт. доход · {format(today, 'MMM', { locale: ru })}</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-300">{formatCurrency(Math.round(actualMonthRevenue))}</p>
                  </div>
                  <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-orange-200/80">Суммарная выручка</p>
                    <p className="mt-1 text-lg font-semibold text-orange-300">{formatCurrency(totalRevenue)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{ganttRentals.filter(r => r.status !== 'created').length} аренд</p>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/70 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Утилизация месяца</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{utilizationMonth}%</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{daysRentedThisMonth} / {daysInCurrentMonth} дн.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {equipment.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Примечания</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{equipment.notes}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>История изменений</CardTitle>
              <CardDescription>Кто и что менял в карточке техники</CardDescription>
            </CardHeader>
            <CardContent>
              {(equipment.history || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">История пока пуста</p>
              ) : (
                <div className="space-y-3">
                  {[...(equipment.history || [])]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((entry, idx) => (
                      <div key={`${entry.date}-${idx}`} className="rounded-xl border border-border bg-secondary/60 p-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-medium">{entry.author}</span>
                          <span>{formatDateTime(entry.date)}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-foreground/90">{entry.text}</p>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ FINANCIAL TAB ══ */}
        {canViewFinance && (
        <TabsContent value="financial">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[--color-primary]" />
                  Финансовые показатели · {currentMonthLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-blue-200/80">Плановый доход/мес</p>
                    <p className="mt-0.5 text-xl text-blue-300">{formatCurrency(equipment.plannedMonthlyRevenue)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-emerald-200/80">Факт. доход за месяц</p>
                    <p className="mt-0.5 text-xl text-emerald-300">{formatCurrency(Math.round(actualMonthRevenue))}</p>
                  </div>
                  <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-orange-200/80">Утилизация за месяц</p>
                    <p className="mt-0.5 text-xl text-orange-300">{utilizationMonth}%</p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-orange-950/40">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${utilizationMonth}%` }} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/70 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Дней в аренде / свободно</p>
                    <p className="mt-0.5 text-xl text-foreground">
                      {daysRentedThisMonth} <span className="text-sm text-muted-foreground">/ {freeDaysThisMonth}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Выполнение плана</span>
                    <span className="font-medium text-foreground">
                      {equipment.plannedMonthlyRevenue > 0
                        ? Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${actualMonthRevenue >= equipment.plannedMonthlyRevenue ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(100, equipment.plannedMonthlyRevenue > 0 ? Math.round((actualMonthRevenue / equipment.plannedMonthlyRevenue) * 100) : 0)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Суммарная выручка (все аренды)</span>
                    <span className="font-medium text-foreground">{formatCurrency(totalRevenue)}</span>
                  </div>
                  {totalPaidRevenue > 0 && (
                    <div className="mt-1.5 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Из них оплачено</span>
                      <span className="font-medium text-emerald-300">{formatCurrency(totalPaidRevenue)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[--color-primary]" />
                  Расчёт для менеджера
                </CardTitle>
                <CardDescription>Владелец: {ownerLabels[equipment.owner]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className={`rounded-xl border p-4 ${
                  equipment.owner === 'own' ? 'border-blue-500/20 bg-blue-500/10' :
                  equipment.owner === 'investor' ? 'border-cyan-500/20 bg-cyan-500/10' :
                  'border-orange-500/20 bg-orange-500/10'
                }`}>
                  {equipment.owner === 'own' && (
                    <div>
                      <p className="text-sm text-muted-foreground">Собственная техника: менеджер получает <span className="font-medium text-foreground">3%</span> от результата</p>
                      <p className="mt-2 text-xs text-muted-foreground">{managerComm.formula}</p>
                      <p className="mt-1 text-2xl text-blue-300">{formatCurrency(managerComm.commission)}</p>
                    </div>
                  )}
                  {equipment.owner === 'investor' && (
                    <div>
                      <p className="text-sm text-muted-foreground">Техника инвестора: 100% выручки − 60%, от оставшихся 40% менеджер получает <span className="font-medium text-foreground">7%</span></p>
                      <p className="mt-2 text-xs text-muted-foreground">{managerComm.formula}</p>
                      <p className="mt-1 text-2xl text-cyan-300">{formatCurrency(managerComm.commission)}</p>
                    </div>
                  )}
                  {equipment.owner === 'sublease' && (
                    <div>
                      <p className="text-sm text-muted-foreground">Субаренда: финансовый результат = цена сдачи − цена взятия</p>
                      <p className="mt-2 text-xs text-muted-foreground">{managerComm.formula}</p>
                      <p className={`mt-1 text-2xl ${managerComm.commission >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {formatCurrency(managerComm.commission)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Факт. выручка за месяц</span>
                    <span className="text-foreground">{formatCurrency(Math.round(actualMonthRevenue))}</span>
                  </div>
                  {equipment.owner === 'sublease' && equipment.subleasePrice && (
                    <div className="flex justify-between">
                      <span>Стоимость субаренды</span>
                      <span className="text-orange-300">−{formatCurrency(equipment.subleasePrice)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border pt-1">
                    <span className="font-medium text-foreground">Комиссия менеджера ({managerComm.rate})</span>
                    <span className="font-medium text-foreground">{formatCurrency(managerComm.commission)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        )}

        {/* ══ RENTAL HISTORY TAB ══ */}
        {canViewRentals && (
        <TabsContent value="rental-history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>История аренды</CardTitle>
                  <CardDescription>{ganttRentals.length} записей</CardDescription>
                </div>
                <Link to="/rentals">
                  <Button size="sm" variant="secondary">
                    <Plus className="h-3.5 w-3.5" />
                    Новая аренда
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {ganttRentals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Клиент</TableHead>
                      <TableHead>Период</TableHead>
                      <TableHead>Дней</TableHead>
                      <TableHead>Менеджер</TableHead>
                      {canViewFinance && <TableHead>Стоимость</TableHead>}
                      {canViewFinance && <TableHead>Оплата</TableHead>}
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ganttRentals.map(gr => {
                      const days = Math.ceil((new Date(gr.endDate).getTime() - new Date(gr.startDate).getTime()) / (1000 * 60 * 60 * 24));
                      const rentalPmts = allPayments.filter(p => p.rentalId === gr.id);
                      const paid = rentalPmts.reduce((s, p) => s + (p.paidAmount ?? p.amount), 0);
                      return (
                        <TableRow key={gr.id}>
                          <TableCell>
                            <span className="font-mono text-xs text-[--color-primary]">{gr.id}</span>
                          </TableCell>
                          <TableCell>{gr.client}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(gr.startDate)} — {formatDate(gr.endDate)}
                          </TableCell>
                          <TableCell>{days}</TableCell>
                          <TableCell className="text-sm">{gr.managerInitials}</TableCell>
                          {canViewFinance && <TableCell>{formatCurrency(gr.amount)}</TableCell>}
                          {canViewFinance && (
                            <TableCell>
                              <Badge variant={gr.paymentStatus === 'paid' ? 'success' : gr.paymentStatus === 'partial' ? 'warning' : 'error'}>
                                {gr.paymentStatus === 'paid' ? 'Оплачено' : gr.paymentStatus === 'partial' ? `${formatCurrency(paid)}` : 'Не опл.'}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge variant={
                              gr.status === 'active' ? 'info' :
                              gr.status === 'returned' ? 'success' :
                              gr.status === 'closed' ? 'default' : 'warning'
                            }>
                              {gr.status === 'active' ? 'Активна' :
                               gr.status === 'returned' ? 'Возвр.' :
                               gr.status === 'closed' ? 'Закр.' : 'Бронь'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Calendar className="h-12 w-12" />} text="История аренды пуста">
                  <Link to="/rentals">
                    <Button variant="secondary" size="sm" className="mt-4">Открыть планировщик</Button>
                  </Link>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* ══ SERVICE HISTORY TAB ══ */}
        {canViewService && (
        <TabsContent value="service-history">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Сервисные заявки</CardTitle>
                  <CardDescription>
                    {openServiceTickets.length} открытых · {serviceHistory.length} всего
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setShowCreateServiceModal(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Создать заявку
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {serviceHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Причина</TableHead>
                      <TableHead>Описание</TableHead>
                      <TableHead>Создана</TableHead>
                      <TableHead>Приоритет</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceHistory.map(ticket => (
                      <TableRow key={ticket.id}>
                        <TableCell>
                          <Link to={`/service/${ticket.id}`} className="font-mono text-xs text-[--color-primary] hover:underline">
                            {ticket.id}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate">{ticket.reason}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                          {ticket.description}
                        </TableCell>
                        <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.priority === 'critical' ? 'error' :
                            ticket.priority === 'high' ? 'warning' :
                            ticket.priority === 'medium' ? 'info' : 'default'
                          }>
                            {ticket.priority === 'critical' ? 'Критич.' :
                             ticket.priority === 'high' ? 'Высокий' :
                             ticket.priority === 'medium' ? 'Средний' : 'Низкий'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            ticket.status === 'in_progress' ? 'info' :
                            ticket.status === 'waiting_parts' ? 'warning' :
                            ticket.status === 'ready' ? 'success' :
                            ticket.status === 'closed' ? 'default' : 'default'
                          }>
                            {SERVICE_STATUS_LABELS[ticket.status] || ticket.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState icon={<Wrench className="h-12 w-12" />} text="Сервисных заявок нет">
                  <Button variant="secondary" size="sm" className="mt-4" onClick={() => setShowCreateServiceModal(true)}>
                    Создать заявку
                  </Button>
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* ══ REPAIR HISTORY TAB ══ */}
        {canViewService && (
        <TabsContent value="repair-history">
          <Card>
            <CardHeader>
              <CardTitle>История ремонтов</CardTitle>
              <CardDescription>Построено по завершённым сервисным заявкам · {repairRecords.length} записей</CardDescription>
            </CardHeader>
            <CardContent>
              {repairRecords.length > 0 ? (
                <div className="space-y-3">
                  {repairRecords.map(record => (
                    <div key={record.id} className="rounded-xl border border-border bg-secondary/50 p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={repairTypeBadge[record.type]}>{repairTypeLabels[record.type]}</Badge>
                            <Badge variant={record.status === 'completed' ? 'success' : record.status === 'in_progress' ? 'info' : 'default'}>
                              {record.status === 'completed' ? 'Выполнено' : record.status === 'in_progress' ? 'В работе' : 'Запланировано'}
                            </Badge>
                            {record.source === 'bot' && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Bot className="h-3 w-3" /> Из бота</span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-foreground">{record.description}</p>
                          {record.comment && (
                            <p className="mt-1 text-sm text-muted-foreground">{record.comment}</p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDate(record.date)}</span>
                            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {record.mechanic}</span>
                            {record.totalNormHours > 0 && <span>{record.totalNormHours.toFixed(1)} н/ч</span>}
                          </div>
                        </div>
                        {canViewFinance && record.cost != null && record.cost > 0 && (
                          <p className="ml-4 font-medium text-foreground">{formatCurrency(record.cost)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {canViewFinance && (
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Всего затрат на ремонты</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(repairRecords.reduce((sum, r) => sum + (r.cost || 0), 0))}
                      </span>
                    </div>
                  </div>
                  )}
                </div>
              ) : (
                <EmptyState icon={<Wrench className="h-12 w-12" />} text="Записей о ремонтах нет" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* ══ PHOTOS TAB ══ */}
        <TabsContent value="photos">
          {Object.keys(PHOTO_CATEGORY_LABELS).map(key => (
            <input
              key={key}
              ref={node => {
                shippingPhotoInputRefs.current[key as EquipmentOperationPhotoCategory] = node;
              }}
              type="file"
              accept="image/*"
              multiple
              data-category={key}
              className="hidden"
              onChange={handleShippingPhotoFilePick}
            />
          ))}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Фото отгрузок и приёмки</CardTitle>
                  <CardDescription>{shippingPhotos.length} событий</CardDescription>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleDownloadShippingPhotosZip()}
                    disabled={shippingPhotos.length === 0 || isDownloadingPhotoZip}
                  >
                    <Download className="h-4 w-4" />
                    {isDownloadingPhotoZip ? 'Собираем ZIP...' : 'Скачать ZIP'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={scrollToComparisonSection}
                    disabled={shippingComparisonPairs.length === 0}
                    title={
                      shippingComparisonPairs.length === 0
                        ? 'Для сравнения нужна пара отгрузка и приёмка по одной аренде'
                        : 'Открыть сравнение фото до и после аренды'
                    }
                  >
                    <ImageIcon className="h-4 w-4" />
                    {shippingComparisonPairs.length > 0 ? 'Сравнить до/после' : 'Нет сравнения'}
                  </Button>
                  {canManageAcceptance && (
                    <>
                    <Button size="sm" variant="secondary" onClick={() => openReceptionForm('shipping')}>
                      <Upload className="h-4 w-4" />
                      Отправить в аренду
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openReceptionForm('receiving')}>
                      <Camera className="h-4 w-4" />
                      Принять с аренды
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setShowUploadPhotoForm(v => !v)}>
                    <Plus className="h-4 w-4" />
                    Загрузить фото
                    </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:hidden">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleDownloadShippingPhotosZip()}
                  disabled={shippingPhotos.length === 0 || isDownloadingPhotoZip}
                >
                  <Download className="h-4 w-4" />
                  {isDownloadingPhotoZip ? 'Собираем ZIP...' : 'Скачать ZIP'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={scrollToComparisonSection}
                  disabled={shippingComparisonPairs.length === 0}
                  title={
                    shippingComparisonPairs.length === 0
                      ? 'Для сравнения нужна пара отгрузка и приёмка по одной аренде'
                      : 'Открыть сравнение фото до и после аренды'
                  }
                >
                  <ImageIcon className="h-4 w-4" />
                  {shippingComparisonPairs.length > 0 ? 'Сравнить до/после' : 'Нет сравнения'}
                </Button>
                {canManageAcceptance && (
                  <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openReceptionForm('shipping')}
                  >
                    <Upload className="h-4 w-4" />
                    Отгрузка
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openReceptionForm('receiving')}>
                    <Camera className="h-4 w-4" />
                    Приёмка
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowUploadPhotoForm(v => !v)}>
                    <Plus className="h-4 w-4" />
                    Загрузить фото/акт
                  </Button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                <span>{shippingPhotos.length} событий</span>
                <span>{shippingGalleryPhotoCount} фото</span>
                {shippingComparisonPairs.length > 0 && <span>{shippingComparisonPairs.length} сравнений аренды</span>}
                {latestShippingEvent && <span>Последняя отгрузка: {formatDate(latestShippingEvent.date)}</span>}
                {latestReceivingEvent && <span>Последняя приёмка: {formatDate(latestReceivingEvent.date)}</span>}
              </div>
              {(latestShippingEvent || latestReceivingEvent) && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {[latestShippingEvent, latestReceivingEvent].filter(Boolean).map(event => {
                    const isCollapsed = isShippingEventCollapsed(event!.id);
                    const categoryCount = event?.photoCategories
                      ? Object.values(event.photoCategories).filter(list => Array.isArray(list) && list.length > 0).length
                      : (event?.photos?.length ? 1 : 0);
                    const checklistComplete = event?.checklist ? Object.values(event.checklist).every(Boolean) : false;
                    return (
                      <div
                        key={event!.id}
                        className={`rounded-xl border p-4 ${
                          event!.type === 'shipping'
                            ? 'border-blue-500/20 bg-blue-500/10'
                            : 'border-emerald-500/20 bg-emerald-500/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant={event!.type === 'shipping' ? 'info' : 'success'}>
                                {event!.type === 'shipping' ? 'Последняя отгрузка' : 'Последняя приёмка'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{formatDate(event!.date)}</span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {event!.uploadedBy}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Моточасы: {event!.hoursValue ?? equipment.hours ?? '—'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleShippingEventCollapsed(event!.id)}
                              className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-400/40 hover:text-blue-300"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} />
                                {isCollapsed ? 'Развернуть' : 'Свернуть'}
                              </span>
                            </button>
                            <button
                              onClick={() => printHandoffAct(event!, equipment)}
                              className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-400/40 hover:text-blue-300"
                            >
                              Акт PDF
                            </button>
                          </div>
                        </div>

                        {!isCollapsed && (
                          <>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-xl border border-border bg-card/70 p-3">
                                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Чек-лист</p>
                                <p className={`mt-1 font-medium ${checklistComplete ? 'text-emerald-300' : 'text-orange-300'}`}>
                                  {checklistComplete ? 'Заполнен полностью' : 'Заполнен частично'}
                                </p>
                              </div>
                              <div className="rounded-xl border border-border bg-card/70 p-3">
                                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Категории фото</p>
                                <p className="mt-1 font-medium text-foreground">{categoryCount}</p>
                              </div>
                            </div>

                            {event!.damageDescription && (
                              <div className="mt-3 rounded-xl border border-orange-500/20 bg-card/70 p-3 text-sm text-orange-200">
                                <p className="text-xs uppercase tracking-wide text-orange-300">Повреждения</p>
                                <p className="mt-1">{event!.damageDescription}</p>
                              </div>
                            )}

                            {event!.photoCategories && Object.keys(event!.photoCategories).length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {Object.entries(PHOTO_CATEGORY_LABELS).map(([key, label]) => {
                                  const photos = event!.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS] || [];
                                  if (!photos.length) return null;
                                  return (
                                    <span
                                      key={key}
                                      className="rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground"
                                    >
                                      {label}: {photos.length}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {shippingComparisonPairs.length > 0 && selectedComparisonPair && (
                <div ref={comparisonSectionRef} className="rounded-2xl border border-border bg-secondary/30 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Сравнение до / после аренды</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Слева фото перед отгрузкой, справа фото после возврата по одной и той же аренде.
                      </p>
                    </div>
                    <div className="w-full lg:w-[360px]">
                      <Select value={selectedComparisonPair.id} onValueChange={setSelectedComparisonPairId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите аренду для сравнения" />
                        </SelectTrigger>
                        <SelectContent>
                          {shippingComparisonPairs.map(pair => (
                            <SelectItem key={pair.id} value={pair.id}>
                              {getComparisonLabel(pair)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Badge variant="info">До аренды</Badge>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            Отгрузка от {formatDate(selectedComparisonPair.shipping.date)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedComparisonPair.shipping.uploadedBy} · {selectedComparisonPair.shipping.hoursValue ?? equipment.hours ?? '—'} м/ч
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => printHandoffAct(selectedComparisonPair.shipping, equipment)}
                        >
                          Акт PDF
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Badge variant="success">После аренды</Badge>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            Приёмка от {formatDate(selectedComparisonPair.receiving.date)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedComparisonPair.receiving.uploadedBy} · {selectedComparisonPair.receiving.hoursValue ?? equipment.hours ?? '—'} м/ч
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => printHandoffAct(selectedComparisonPair.receiving, equipment)}
                        >
                          Акт PDF
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {selectedComparisonGroups.map(group => (
                      <div key={group.key} className="rounded-xl border border-border bg-card/80 p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-foreground">{group.label}</p>
                            <p className="text-xs text-muted-foreground">
                              До аренды: {group.beforePhotos.length} · После аренды: {group.afterPhotos.length}
                            </p>
                          </div>
                          {(group.beforePhotos.length !== group.afterPhotos.length) && (
                            <Badge variant="warning">Есть отличия по количеству фото</Badge>
                          )}
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                          <ComparisonPhotoColumn
                            title="До аренды"
                            tone="before"
                            photos={group.beforePhotos}
                            onPreview={setPreviewImage}
                          />
                          <ComparisonPhotoColumn
                            title="После аренды"
                            tone="after"
                            photos={group.afterPhotos}
                            onPreview={setPreviewImage}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload form */}
              {canManageAcceptance && showUploadPhotoForm && (
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-200">
                      {uploadEventType === 'shipping' ? 'Отправка техники в аренду' : 'Приёмка техники с аренды'}
                    </span>
                    <button
                      onClick={() => {
                        setShowUploadPhotoForm(false);
                        setUploadPhotoCategories(createEmptyPhotoCategories(uploadEventType === 'receiving'));
                        setUploadComment('');
                        setUploadChecklist(createEmptyHandoffChecklist());
                        setUploadHoursValue('');
                        setUploadDamageDescription('');
                        setUploadSignatureDataUrl('');
                      }}
                      className="rounded p-1 text-blue-300 transition hover:bg-blue-500/10"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Event type */}
                  <div className="flex gap-2">
                    {(['shipping', 'receiving'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => {
                          setUploadEventType(t);
                          setUploadChecklist(createEmptyHandoffChecklist());
                          setUploadPhotoCategories(createEmptyPhotoCategories(t === 'receiving'));
                          setUploadDamageDescription('');
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          uploadEventType === t
                            ? 'bg-blue-600 text-white'
                            : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t === 'shipping' ? 'Отгрузка' : 'Приёмка'}
                      </button>
                    ))}
                  </div>

                  {uploadEventType === 'shipping' && (
                    <div className="rounded-xl border border-blue-500/20 bg-card/70 px-3 py-2 text-xs text-blue-200">
                      После сохранения фотоотчёт запишется в карточку техники. Если по технике есть бронь/аренда, она будет переведена в статус активной.
                    </div>
                  )}

                  {uploadEventType === 'receiving' && (
                    <div className="rounded-xl border border-orange-500/20 bg-card/70 px-3 py-2 text-xs text-orange-200">
                      После сохранения техника автоматически перейдёт в сервис, аренда будет отмечена как возвращённая, и будет создана сервисная заявка на осмотр после возврата.
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Моточасы
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="Введите моточасы"
                        value={uploadHoursValue}
                        onChange={e => setUploadHoursValue(e.target.value)}
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Подпись механика
                      </label>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setSignatureModalOpen(true)}>
                          <PenLine className="h-4 w-4" />
                          {uploadSignatureDataUrl ? 'Обновить подпись' : 'Добавить подпись'}
                        </Button>
                        {uploadSignatureDataUrl && (
                          <Button type="button" size="sm" variant="secondary" onClick={() => setUploadSignatureDataUrl('')}>
                            <RotateCcw className="h-4 w-4" />
                            Сбросить
                          </Button>
                        )}
                      </div>
                      {!uploadSignatureDataUrl && (
                        <p className="mt-1 text-xs text-orange-300">Подпись обязательна для акта.</p>
                      )}
                    </div>
                  </div>

                  {/* Comment */}
                  <input
                    type="text"
                    placeholder="Комментарий (необязательно)"
                    value={uploadComment}
                    onChange={e => setUploadComment(e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />

                  {uploadEventType === 'receiving' && (
                    <textarea
                      placeholder="Опишите выявленные повреждения"
                      value={uploadDamageDescription}
                      onChange={e => setUploadDamageDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  )}

                  {/* Checklist */}
                  <div className="rounded-xl border border-border bg-card/70 p-3">
                    <div className="mb-2 text-sm font-medium text-foreground">
                      Чек-лист {uploadEventType === 'shipping' ? 'отгрузки' : 'приёмки'}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(HANDOFF_CHECKLIST_LABELS).map(([key, label]) => {
                        const checklistKey = key as keyof typeof HANDOFF_CHECKLIST_LABELS;
                        const checked = uploadChecklist[checklistKey];
                        return (
                          <label
                            key={key}
                            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                              checked
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                                : 'border-border bg-secondary/70 text-muted-foreground'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-border bg-card text-blue-500 focus:ring-blue-500"
                              checked={checked}
                              onChange={(e) => setUploadChecklist(prev => ({ ...prev, [checklistKey]: e.target.checked }))}
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {!isChecklistComplete(uploadChecklist) && (
                      <p className="mt-2 text-xs text-orange-300">
                        Перед сохранением нужно отметить все пункты чек-листа.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {Object.entries(PHOTO_CATEGORY_LABELS)
                      .filter(([key]) => uploadEventType === 'receiving' || key !== 'damage_photo')
                      .map(([key, label]) => {
                        const categoryKey = key as EquipmentOperationPhotoCategory;
                        const photos = uploadPhotoCategories[categoryKey] ?? [];
                        return (
                          <div key={key} className="rounded-xl border border-border bg-card/70 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium text-foreground">{label}</div>
                                <div className="text-xs text-muted-foreground">{photos.length > 0 ? `${photos.length} фото` : 'Фото не добавлены'}</div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => shippingPhotoInputRefs.current[categoryKey]?.click()}
                              >
                                <Camera className="h-4 w-4" />
                                Добавить
                              </Button>
                            </div>
                            {photos.length > 0 && (
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {photos.map((src, i) => (
                                  <div key={`${key}-${i}`} className="relative shrink-0">
                                    <img src={src} alt={`${label} ${i + 1}`} className="h-20 w-28 rounded-md border border-border object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => setUploadPhotoCategories(prev => ({
                                        ...prev,
                                        [categoryKey]: (prev[categoryKey] ?? []).filter((_, idx) => idx !== i),
                                      }))}
                                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {getMissingPhotoCategoryLabels(uploadPhotoCategories, uploadEventType).length > 0 && (
                    <div className="rounded-xl border border-orange-500/20 bg-card/70 px-3 py-2 text-xs text-orange-200">
                      Для акта не хватает фото: {getMissingPhotoCategoryLabels(uploadPhotoCategories, uploadEventType).join(', ')}.
                    </div>
                  )}

                  <Button
                    size="sm"
                    onClick={handleShippingPhotoSave}
                    disabled={
                      !isChecklistComplete(uploadChecklist)
                      || !isPhotoCategoryComplete(uploadPhotoCategories, uploadEventType)
                      || !uploadSignatureDataUrl
                      || !uploadHoursValue
                      || (uploadEventType === 'receiving' && !uploadDamageDescription.trim())
                    }
                  >
                    <Upload className="h-4 w-4" />
                    Сохранить событие
                  </Button>
                </div>
              )}

              {/* Photo events list */}
              {shippingPhotos.length > 0 ? (
                <div className="space-y-6">
                  {shippingPhotos.map(event => (
                    <div key={event.id} className="rounded-2xl border border-border bg-card/70 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={event.type === 'shipping' ? 'info' : 'success'}>
                            {event.type === 'shipping' ? 'Отгрузка' : 'Приёмка (возврат)'}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{formatDate(event.date)}</span>
                          {event.source === 'bot' && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Bot className="h-3 w-3" /> Из бота</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Загрузил: {event.uploadedBy}</span>
                          <button
                            onClick={() => toggleShippingEventCollapsed(event.id)}
                            className="rounded-xl border border-border px-2 py-1 text-xs text-foreground transition hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300"
                            title={isShippingEventCollapsed(event.id) ? 'Развернуть событие' : 'Свернуть событие'}
                          >
                            <span className="inline-flex items-center gap-1">
                              <ChevronDown className={cn('h-4 w-4 transition-transform', isShippingEventCollapsed(event.id) && '-rotate-90')} />
                              {isShippingEventCollapsed(event.id) ? 'Развернуть' : 'Свернуть'}
                            </span>
                          </button>
                          <button
                            onClick={() => printHandoffAct(event, equipment)}
                            className="rounded-xl border border-border px-2 py-1 text-xs text-blue-300 transition hover:border-blue-400/40 hover:bg-blue-500/10"
                            title="Скачать акт PDF"
                          >
                            Акт PDF
                          </button>
                          {canEditEquipment && (
                            <button
                              onClick={() => {
                                const updated = allShippingPhotos.filter(p => p.id !== event.id);
                                void persistShippingPhotos(updated);
                              }}
                              className="rounded p-1 text-muted-foreground transition hover:bg-secondary hover:text-red-300"
                              title="Удалить событие"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {!isShippingEventCollapsed(event.id) && (
                        <>
                          {event.comment && <p className="mt-2 text-sm text-muted-foreground">{event.comment}</p>}
                          {event.checklist && (
                            <div className="mt-3 rounded-xl border border-border bg-secondary/70 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Чек-лист операции
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {Object.entries(HANDOFF_CHECKLIST_LABELS).map(([key, label]) => {
                                  const checklistKey = key as keyof typeof HANDOFF_CHECKLIST_LABELS;
                                  const checked = event.checklist?.[checklistKey];
                                  return (
                                    <div key={key} className="flex items-center gap-2 text-sm">
                                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
                                        checked
                                          ? 'bg-emerald-500/15 text-emerald-300'
                                          : 'bg-secondary text-muted-foreground'
                                      }`}>
                                        {checked ? '✓' : '•'}
                                      </span>
                                      <span className="text-foreground/90">{label}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {event.photoCategories && Object.keys(event.photoCategories).length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {Object.entries(PHOTO_CATEGORY_LABELS).map(([key, label]) => {
                                const photos = event.photoCategories?.[key as keyof typeof PHOTO_CATEGORY_LABELS] || [];
                                if (!photos.length) return null;
                                return (
                                  <div key={key}>
                                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      {label}
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto pb-1">
                                      {photos.map((photo, idx) => (
                                        <img
                                          key={`${key}-${idx}`}
                                          src={photo}
                                          alt={`${label} ${idx + 1}`}
                                          className="h-32 w-48 shrink-0 rounded-lg border border-border object-cover cursor-zoom-in hover:opacity-90"
                                          onClick={() => setPreviewImage(photo)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                              {event.photos.map((photo, idx) => (
                                <img key={idx} src={photo} alt={`Фото ${idx + 1}`}
                                  className="h-32 w-48 shrink-0 rounded-lg border border-border object-cover cursor-zoom-in hover:opacity-90"
                                  onClick={() => setPreviewImage(photo)}
                                />
                              ))}
                            </div>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">{event.photos.length} фото · нажмите для просмотра</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                !showUploadPhotoForm && (
                  <EmptyState icon={<Camera className="h-12 w-12" />} text="Фотографий пока нет">
                    {canEditEquipment && (
                      <button
                        onClick={() => setShowUploadPhotoForm(true)}
                        className="mt-3 text-sm text-[--color-primary] hover:underline"
                      >
                        Загрузить первое фото
                      </button>
                    )}
                  </EmptyState>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══ DOCUMENTS TAB ══ */}
        {canViewDocuments && (
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Документы</CardTitle>
            </CardHeader>
            <CardContent>
              {equipment360.documents.latest.length > 0 ? (
                <div className="space-y-2">
                  {equipment360.documents.latest.map(doc => (
                    <LinkedRow
                      key={doc.id || `${doc.type}-${doc.date}`}
                      title={`${doc.type}${doc.id ? ` · ${doc.id}` : ''}`}
                      meta={`${formatDate(doc.date)} · ${doc.status}`}
                      href="/documents"
                      canOpen={canViewDocuments}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<FileText className="h-12 w-12" />} text="Связанных документов нет" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      {/* ── Modals ── */}
      <Dialog.Root open={showCreateServiceModal} onOpenChange={setShowCreateServiceModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(96vw,960px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">
                  Новая сервисная заявка
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Заявка будет создана сразу для текущего подъемника.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="rounded-md p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
            <ServiceTicketForm
              initialEquipmentId={equipment.id}
              lockEquipment
              submitLabel="Создать заявку"
              onCancel={() => setShowCreateServiceModal(false)}
              onCreated={(ticket) => {
                setAllServiceTickets(prev => [ticket, ...prev.filter(item => item.id !== ticket.id)]);
                const nextEquipment = allEquipment.map(item =>
                  item.id === equipment.id
                    ? appendAuditHistory(
                        { ...item, status: 'in_service', currentClient: undefined, returnDate: undefined },
                        createAuditEntry(
                          user?.name || 'Система',
                          `Создана сервисная заявка ${ticket.id}: ${ticket.reason}`,
                        ),
                      )
                    : item,
                );
                void persistEquipment(nextEquipment);
                setShowCreateServiceModal(false);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <EditEquipmentModal
        open={showEditModal}
        equipment={equipment}
        canViewFinance={canViewFinance}
        onOpenChange={setShowEditModal}
        onSave={(updated) => {
          const normalizedUpdated = {
            ...updated,
            gsmImei: updated.gsmImei || null,
            gsmDeviceId: updated.gsmDeviceId || null,
            gsmProtocol: updated.gsmProtocol || null,
            gsmSimNumber: updated.gsmSimNumber || null,
            gsmStatus: updated.gsmStatus || 'unknown',
          };
          const historyEntries = buildFieldDiffHistory(
            equipment,
            normalizedUpdated,
            {
              inventoryNumber: 'инвентарный номер',
              serialNumber: 'серийный номер',
              manufacturer: 'производитель',
              model: 'модель',
              type: 'тип',
              drive: 'привод',
              year: 'год выпуска',
              hours: 'моточасы',
              liftHeight: 'высота подъёма',
              workingHeight: 'рабочая высота',
              loadCapacity: 'грузоподъёмность',
              weight: 'масса',
              dimensions: 'габариты',
              owner: 'собственник',
              category: 'категория',
              priority: 'приоритет',
              activeInFleet: 'активный парк',
              isForSale: 'на продаже',
              salePdiStatus: 'статус PDI',
              salePrice1: 'цена 1',
              salePrice2: 'цена 2',
              salePrice3: 'цена 3',
              subleasePrice: 'стоимость субаренды',
              location: 'локация',
              status: 'статус',
              plannedMonthlyRevenue: 'плановый доход',
              nextMaintenance: 'следующее ТО',
              maintenanceCHTO: 'дата ЧТО',
              maintenancePTO: 'дата ПТО',
              gsmImei: 'GSM IMEI',
              gsmDeviceId: 'Device ID',
              gsmProtocol: 'GSM протокол',
              gsmSimNumber: 'SIM-карта',
              notes: 'примечание',
            },
            user?.name || 'Система',
            'Обновлена карточка техники',
          );
          const withHistory = appendAuditHistory(normalizedUpdated, ...historyEntries);
          const list = allEquipment.map(e => e.id === normalizedUpdated.id ? withHistory : e);
          void persistEquipment(list);
          setShowEditModal(false);
        }}
      />
      <Dialog.Root open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(96vw,1200px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none">
            {previewImage && (
              <div className="relative w-full">
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
                  aria-label="Закрыть просмотр"
                >
                  <X className="h-5 w-5" />
                </button>
                <img
                  src={previewImage}
                  alt="Просмотр фото"
                  className="max-h-[92vh] w-full rounded-xl bg-black object-contain"
                />
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── Helper Components ──

function InfoField({ label, value, mono, highlight }: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'orange';
}) {
  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`font-medium ${mono ? 'font-mono text-sm' : ''} ${highlight === 'orange' ? 'text-orange-600' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto text-gray-400">{icon}</div>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{text}</p>
      {children}
    </div>
  );
}

function CompactMetric({ label, value, tone = 'default' }: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = tone === 'success'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : tone === 'warning'
    ? 'border-orange-500/20 bg-orange-500/10 text-orange-300'
    : tone === 'danger'
    ? 'border-red-500/20 bg-red-500/10 text-red-300'
    : 'border-border bg-secondary/60 text-foreground';
  return (
    <div className={cn('rounded-lg border p-3', toneClass)}>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value || 'Нет данных'}</p>
    </div>
  );
}

function LinkedRow({ title, meta, href, canOpen }: {
  title: string;
  meta: string;
  href: string;
  canOpen: boolean;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{title || 'Запись'}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta || 'Детали не указаны'}</p>
      </div>
      {canOpen && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );

  if (!canOpen) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/50 px-3 py-2">{content}</div>;
  }

  return (
    <Link to={href} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/50 px-3 py-2 transition hover:border-blue-400/40 hover:bg-blue-500/10">
      {content}
    </Link>
  );
}

function CompactList({ title, emptyText, items, canOpen }: {
  title: string;
  emptyText: string;
  items: Array<{ id: string; title: string; meta: string; href: string }>;
  canOpen: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge variant="default">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map(item => (
            <LinkedRow key={item.id || `${item.title}-${item.meta}`} title={item.title} meta={item.meta} href={item.href} canOpen={canOpen} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

function ComparisonPhotoColumn({
  title,
  tone,
  photos,
  onPreview,
}: {
  title: string;
  tone: 'before' | 'after';
  photos: string[];
  onPreview: (value: string) => void;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      tone === 'before'
        ? 'border-blue-500/20 bg-blue-500/5'
        : 'border-emerald-500/20 bg-emerald-500/5',
    )}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">{photos.length} фото</span>
      </div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <button
              key={`${title}-${index}`}
              type="button"
              onClick={() => onPreview(photo)}
              className="group overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-primary/40"
            >
              <img
                src={photo}
                alt={`${title} ${index + 1}`}
                className="h-28 w-full object-cover transition group-hover:scale-[1.02]"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
          Фото в этой части аренды не добавлены.
        </div>
      )}
    </div>
  );
}

// ── Reusable form primitives for the Edit modal ──────────────────────────────

function FormField({
  label, hint, unit, required, children,
}: {
  label: string;
  hint?: string;
  unit?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
        {unit && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
            {unit}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

function FormSection({
  title, icon, children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

function FieldInput({
  value, onChange, type = 'text', placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
    />
  );
}

function FieldSelect({
  value, onValueChange, options, placeholder,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
        <SelectValue placeholder={placeholder || 'Выберите...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getSalePdiBadge(status: EquipmentSalePdiStatus = 'not_started') {
  const variants: Record<EquipmentSalePdiStatus, 'default' | 'warning' | 'success'> = {
    not_started: 'default',
    in_progress: 'warning',
    ready: 'success',
  };
  return <Badge variant={variants[status]}>{EQUIPMENT_SALE_PDI_LABELS[status]}</Badge>;
}

// ── Main modal ────────────────────────────────────────────────────────────────

function EditEquipmentModal({
  open, equipment, canViewFinance, onOpenChange, onSave,
}: {
  open: boolean;
  equipment: Equipment;
  canViewFinance: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (updated: Equipment) => void;
}) {
  const [form, setForm] = useState(equipment);
  const equipmentTypeOptions = useEquipmentTypeCatalog();

  useEffect(() => {
    if (open) setForm(equipment);
  }, [open, equipment]);

  const set = (field: keyof Equipment, value: string | number | boolean | undefined) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const setStr = (field: keyof Equipment) => (v: string) => set(field, v);
  const setNum = (field: keyof Equipment) => (v: string) => set(field, v === '' ? undefined : Number(v));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900">

          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <Dialog.Title className="text-lg font-bold text-gray-900 dark:text-white">
              Редактировать технику
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {equipment.inventoryNumber} · {equipment.manufacturer} {equipment.model}
            </Dialog.Description>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(92vh - 130px)' }}>
            <div className="space-y-6 px-6 py-5">

              {/* ── Блок 1: Идентификация ── */}
              <FormSection title="Идентификация" icon={<FileText className="h-3.5 w-3.5" />}>
                <FormField
                  label="Инвентарный номер"
                  hint="Внутренний номер учёта техники в компании"
                  required
                >
                  <FieldInput
                    value={form.inventoryNumber}
                    onChange={setStr('inventoryNumber')}
                    placeholder="Например: 044, ПП-12"
                  />
                </FormField>

                <FormField
                  label="Серийный номер / SN"
                  hint="Номер с шильдика или паспорта техники"
                >
                  <FieldInput
                    value={form.serialNumber}
                    onChange={setStr('serialNumber')}
                    placeholder="Например: B200063919"
                  />
                </FormField>

                <FormField
                  label="Производитель"
                  hint="Бренд: JLG, Genie, Haulotte, Manitou…"
                  required
                >
                  <FieldInput
                    value={form.manufacturer}
                    onChange={setStr('manufacturer')}
                    placeholder="Например: JLG"
                  />
                </FormField>

                <FormField
                  label="Модель"
                  hint="Заводская модель техники"
                  required
                >
                  <FieldInput
                    value={form.model}
                    onChange={setStr('model')}
                    placeholder="Например: 1932R"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 2: Характеристики ── */}
              <FormSection title="Технические характеристики" icon={<Wrench className="h-3.5 w-3.5" />}>
                <FormField label="Тип техники" hint="Выбор из справочника">
                  <FieldSelect
                    value={form.type}
                    onValueChange={setStr('type')}
                    options={equipmentTypeOptions}
                  />
                </FormField>

                <FormField label="Привод" hint="Тип энергоустановки">
                  <FieldSelect
                    value={form.drive}
                    onValueChange={setStr('drive')}
                    options={[
                      { value: 'diesel',   label: '⛽ Дизельный' },
                      { value: 'electric', label: '⚡ Электрический' },
                    ]}
                  />
                </FormField>

                <FormField
                  label="Год выпуска"
                  hint="Год изготовления по паспорту техники"
                >
                  <FieldInput
                    type="number"
                    value={String(form.year)}
                    onChange={setNum('year')}
                    placeholder="Например: 2022"
                  />
                </FormField>

                <FormField
                  label="Моточасы / наработка"
                  unit="м/ч"
                  hint="Текущие показания счётчика наработки"
                >
                  <FieldInput
                    type="number"
                    value={String(form.hours)}
                    onChange={setNum('hours')}
                    placeholder="Например: 1250"
                  />
                </FormField>

                <FormField
                  label="Высота подъёма"
                  unit="м"
                  hint="Максимальная высота подъёма платформы"
                >
                  <FieldInput
                    type="number"
                    value={String(form.liftHeight)}
                    onChange={setNum('liftHeight')}
                    placeholder="Например: 8"
                  />
                </FormField>

                <FormField
                  label="Рабочая высота"
                  unit="м"
                  hint="Максимальная рабочая высота с оператором"
                >
                  <FieldInput
                    type="number"
                    value={String(form.workingHeight || '')}
                    onChange={setNum('workingHeight')}
                    placeholder="Обычно = высота подъёма + 2 м"
                  />
                </FormField>

                <FormField
                  label="Грузоподъёмность"
                  unit="кг"
                  hint="Максимальная нагрузка на платформу"
                >
                  <FieldInput
                    type="number"
                    value={String(form.loadCapacity || '')}
                    onChange={setNum('loadCapacity')}
                    placeholder="Например: 230"
                  />
                </FormField>

                <FormField
                  label="Масса техники"
                  unit="кг"
                  hint="Снаряжённая масса по паспорту"
                >
                  <FieldInput
                    type="number"
                    value={String(form.weight || '')}
                    onChange={setNum('weight')}
                    placeholder="Например: 1800"
                  />
                </FormField>

                <FormField
                  label="Габариты"
                  hint="Длина × ширина × высота в сложенном положении"
                  // spans full width
                >
                  <FieldInput
                    value={form.dimensions || ''}
                    onChange={setStr('dimensions')}
                    placeholder="Например: 2.44 × 0.81 × 1.97 м"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 3: Владение и размещение ── */}
              <FormSection title="Владение и размещение" icon={<MapPin className="h-3.5 w-3.5" />}>
                <FormField label="Собственник техники" hint="Определяет схему расчёта комиссии менеджера">
                  <FieldSelect
                    value={form.owner}
                    onValueChange={setStr('owner')}
                    options={[
                      { value: 'own',      label: '🏢 Собственная (компания)' },
                      { value: 'investor', label: '👤 Техника инвестора' },
                      { value: 'sublease', label: '🔄 Субаренда' },
                    ]}
                  />
                </FormField>

                <FormField label="Категория техники" hint="Логическая группа техники в реестре">
                  <FieldSelect
                    value={form.category}
                    onValueChange={setStr('category')}
                    options={[
                      { value: 'own', label: EQUIPMENT_CATEGORY_LABELS.own },
                      { value: 'sold', label: EQUIPMENT_CATEGORY_LABELS.sold },
                      { value: 'client', label: EQUIPMENT_CATEGORY_LABELS.client },
                      { value: 'partner', label: EQUIPMENT_CATEGORY_LABELS.partner },
                    ]}
                  />
                </FormField>

                <FormField label="Приоритет техники" hint="Влияет на сортировку и визуальный акцент в списках и планировщике">
                  <FieldSelect
                    value={form.priority}
                    onValueChange={setStr('priority')}
                    options={[
                      { value: 'critical', label: EQUIPMENT_PRIORITY_LABELS.critical },
                      { value: 'high', label: EQUIPMENT_PRIORITY_LABELS.high },
                      { value: 'medium', label: EQUIPMENT_PRIORITY_LABELS.medium },
                      { value: 'low', label: EQUIPMENT_PRIORITY_LABELS.low },
                    ]}
                  />
                </FormField>

                <FormField label="Участвует в активном парке" hint="Определяет, можно ли использовать технику в аренде">
                  <FieldSelect
                    value={form.activeInFleet ? 'yes' : 'no'}
                    onValueChange={v => set('activeInFleet', v === 'yes')}
                    options={[
                      { value: 'yes', label: 'Да' },
                      { value: 'no', label: 'Нет' },
                    ]}
                  />
                </FormField>

                {canViewFinance && form.owner === 'sublease' && (
                  <FormField
                    label="Стоимость субаренды"
                    unit="₽/мес"
                    hint="Ежемесячная стоимость аренды у поставщика"
                  >
                    <FieldInput
                      type="number"
                      value={String(form.subleasePrice || '')}
                      onChange={setNum('subleasePrice')}
                      placeholder="Например: 50000"
                    />
                  </FormField>
                )}

                <FormField
                  label="Локация / склад"
                  hint="Текущее место хранения или размещения техники"
                >
                  <FieldInput
                    value={form.location}
                    onChange={setStr('location')}
                    placeholder="Например: Казань, склад 1"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              <FormSection title="GSM / GPRS" icon={<Bot className="h-3.5 w-3.5" />}>
                <FormField label="GSM IMEI" hint="IMEI используется для автоматической привязки входящих пакетов">
                  <FieldInput
                    value={form.gsmImei || ''}
                    onChange={setStr('gsmImei')}
                    placeholder="866123456789012"
                  />
                </FormField>

                <FormField label="Device ID" hint="Внутренний идентификатор трекера, если протокол передаёт не IMEI">
                  <FieldInput
                    value={form.gsmDeviceId || ''}
                    onChange={setStr('gsmDeviceId')}
                    placeholder="TRACKER-001"
                  />
                </FormField>

                <FormField label="SIM-карта" hint="Номер SIM для обслуживания и диагностики связи">
                  <FieldInput
                    value={form.gsmSimNumber || ''}
                    onChange={setStr('gsmSimNumber')}
                    placeholder="+7 999 000-00-00"
                  />
                </FormField>

                <FormField label="Протокол" hint="Можно заполнить позже после определения модели трекера">
                  <FieldInput
                    value={form.gsmProtocol || ''}
                    onChange={setStr('gsmProtocol')}
                    placeholder="GT06 / Teltonika / Wialon IPS"
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              <FormSection title="Продажа" icon={<FileText className="h-3.5 w-3.5" />}>
                <FormField label="Техника выставлена на продажу" hint="Если включено, единица появится в разделе продаж и в sale-представлениях">
                  <FieldSelect
                    value={form.isForSale ? 'yes' : 'no'}
                    onValueChange={(v) => set('isForSale', v === 'yes')}
                    options={[
                      { value: 'no', label: 'Нет' },
                      { value: 'yes', label: 'Да' },
                    ]}
                  />
                </FormField>

                {form.isForSale && (
                  <>
                    <FormField label="Статус PDI" hint="Готовность техники к продаже и передаче клиенту">
                      <FieldSelect
                        value={form.salePdiStatus || 'not_started'}
                        onValueChange={setStr('salePdiStatus')}
                        options={[
                          { value: 'not_started', label: EQUIPMENT_SALE_PDI_LABELS.not_started },
                          { value: 'in_progress', label: EQUIPMENT_SALE_PDI_LABELS.in_progress },
                          { value: 'ready', label: EQUIPMENT_SALE_PDI_LABELS.ready },
                        ]}
                      />
                    </FormField>

                    {canViewFinance ? (
                      <>
                        <FormField label="Цена 1" unit="₽" hint="Основная прайс-лист цена">
                          <FieldInput
                            type="number"
                            value={String(form.salePrice1 || '')}
                            onChange={setNum('salePrice1')}
                            placeholder="Например: 4950000"
                          />
                        </FormField>

                        <FormField label="Цена 2" unit="₽" hint="Цена для переговоров">
                          <FieldInput
                            type="number"
                            value={String(form.salePrice2 || '')}
                            onChange={setNum('salePrice2')}
                            placeholder="Например: 4750000"
                          />
                        </FormField>

                        <FormField label="Цена 3" unit="₽" hint="Минимально допустимая цена">
                          <FieldInput
                            type="number"
                            value={String(form.salePrice3 || '')}
                            onChange={setNum('salePrice3')}
                            placeholder="Например: 4550000"
                          />
                        </FormField>
                      </>
                    ) : (
                      <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                        Цены скрыты правами доступа.
                      </p>
                    )}
                  </>
                )}
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 4: Обслуживание ── */}
              <FormSection title="Обслуживание" icon={<Wrench className="h-3.5 w-3.5" />}>
                {canViewFinance && (
                  <FormField
                    label="Плановый доход в месяц"
                    unit="₽"
                    hint="Ориентир для оценки загрузки и эффективности"
                  >
                    <FieldInput
                      type="number"
                      value={String(form.plannedMonthlyRevenue)}
                      onChange={setNum('plannedMonthlyRevenue')}
                      placeholder="Например: 80000"
                    />
                  </FormField>
                )}
                <FormField
                  label="Следующее ТО"
                  hint="Дата планового технического обслуживания"
                  required
                >
                  <FieldInput
                    type="date"
                    value={form.nextMaintenance}
                    onChange={setStr('nextMaintenance')}
                  />
                </FormField>

                <FormField
                  label="Дата ЧТО"
                  hint="Дата последнего частичного технического обслуживания"
                >
                  <FieldInput
                    type="date"
                    value={form.maintenanceCHTO || ''}
                    onChange={setStr('maintenanceCHTO')}
                  />
                </FormField>

                <FormField
                  label="Дата ПТО"
                  hint="Дата последнего периодического технического осмотра"
                >
                  <FieldInput
                    type="date"
                    value={form.maintenancePTO || ''}
                    onChange={setStr('maintenancePTO')}
                  />
                </FormField>
              </FormSection>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* ── Блок 5: Примечание ── */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Примечание</h3>
                </div>
                <FormField
                  label="Комментарий"
                  hint="Любая дополнительная информация по технике: история покупки, особенности эксплуатации, ограничения"
                >
                  <textarea
                    value={form.notes || ''}
                    onChange={e => setStr('notes')(e.target.value)}
                    placeholder="Введите произвольный комментарий..."
                    rows={3}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
                  />
                </FormField>
              </div>

            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Поля, отмеченные <span className="text-red-500">*</span>, обязательны
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button onClick={() => onSave(form)}>Сохранить изменения</Button>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
