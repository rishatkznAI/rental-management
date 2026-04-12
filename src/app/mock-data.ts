import {
  Equipment,
  Rental,
  ServiceTicket,
  Client,
  Document,
  Payment,
  RepairRecord,
  ShippingPhoto,
  Mechanic,
  ServiceWorkCatalogItem,
  SparePartCatalogItem,
} from './types';
import { api } from './lib/api';

// ========== Пустая база данных ==========
// Добавляйте свои данные через интерфейс приложения

export const mockEquipment: Equipment[] = [];

// ─── Внутренний helper: bulk-replace коллекции на сервере ────────────────────
// Fire-and-forget: не блокирует UI, ошибки логируются молча.

function serverSync(collection: string, list: unknown[]): void {
  api.put(`/api/${collection}`, list).catch(() => {
    // Не показываем ошибку пользователю — данные уже в localStorage
  });
}

// ── localStorage + server для техники ────────────────────────────────────────
export const EQUIPMENT_STORAGE_KEY = 'app_equipment';

export function loadEquipment(): Equipment[] {
  try {
    const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Equipment[];
  } catch { /* ignore */ }
  return [];
}

export function saveEquipment(list: Equipment[]): void {
  localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(list));
  serverSync('equipment', list);
}

export const mockRepairRecords: RepairRecord[] = [];

export const mockShippingPhotos: ShippingPhoto[] = [];

export const mockRentals: Rental[] = [];

// ── localStorage + server для аренд ──────────────────────────────────────────
export const RENTALS_STORAGE_KEY = 'app_rentals';
export function loadRentals(): Rental[] {
  try { const r = localStorage.getItem(RENTALS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveRentals(list: Rental[]): void {
  localStorage.setItem(RENTALS_STORAGE_KEY, JSON.stringify(list));
  serverSync('rentals', list);
}

export const mockServiceTickets: ServiceTicket[] = [];

// ── localStorage + server для сервисных заявок ───────────────────────────────
export const SERVICE_STORAGE_KEY = 'app_service_tickets';
export function loadServiceTickets(): ServiceTicket[] {
  try { const r = localStorage.getItem(SERVICE_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveServiceTickets(list: ServiceTicket[]): void {
  localStorage.setItem(SERVICE_STORAGE_KEY, JSON.stringify(list));
  serverSync('service', list);
}

// Экспорт для обратной совместимости
export const mockServiceRequests = mockServiceTickets;

// ========== Gantt-специфичные данные ==========

export interface GanttRentalData {
  id: string;
  client: string;
  clientShort: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  manager: string;
  managerInitials: string;
  status: 'created' | 'active' | 'returned' | 'closed';
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  updSigned: boolean;
  updDate?: string;
  amount: number;
  expectedPaymentDate?: string;
  comments: { date: string; text: string; author: string }[];
}

export interface DowntimePeriod {
  id: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface ServicePeriod {
  id: string;
  equipmentInv: string;
  startDate: string;
  endDate: string;
  description: string;
}

export const mockGanttRentals: GanttRentalData[] = [];

// ── localStorage + server для Gantt-аренд ────────────────────────────────────
export const GANTT_RENTALS_STORAGE_KEY = 'app_gantt_rentals';
export function loadGanttRentals(): GanttRentalData[] {
  try { const r = localStorage.getItem(GANTT_RENTALS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveGanttRentals(list: GanttRentalData[]): void {
  localStorage.setItem(GANTT_RENTALS_STORAGE_KEY, JSON.stringify(list));
  serverSync('gantt_rentals', list);
}

export const mockDowntimes: DowntimePeriod[] = [];

export const mockServicePeriods: ServicePeriod[] = [];

// ── localStorage + server для фото отгрузок/приёмки ──────────────────────────
export const SHIPPING_PHOTOS_KEY = 'app_shipping_photos';
export function loadShippingPhotos(): ShippingPhoto[] {
  try { const r = localStorage.getItem(SHIPPING_PHOTOS_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveShippingPhotos(list: ShippingPhoto[]): void {
  localStorage.setItem(SHIPPING_PHOTOS_KEY, JSON.stringify(list));
  serverSync('shipping_photos', list);
}

export const mockClients: Client[] = [];

// ── localStorage + server для клиентов ───────────────────────────────────────
export const CLIENTS_STORAGE_KEY = 'app_clients';
export function loadClients(): Client[] {
  try { const r = localStorage.getItem(CLIENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveClients(list: Client[]): void {
  localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(list));
  serverSync('clients', list);
}

export const mockDocuments: Document[] = [];

// ── localStorage + server для документов ─────────────────────────────────────
export const DOCUMENTS_STORAGE_KEY = 'app_documents';
export function loadDocuments(): Document[] {
  try { const r = localStorage.getItem(DOCUMENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveDocuments(list: Document[]): void {
  localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(list));
  serverSync('documents', list);
}

export const mockPayments: Payment[] = [];

// ── localStorage + server для платежей ───────────────────────────────────────
export const PAYMENTS_STORAGE_KEY = 'app_payments';
export function loadPayments(): Payment[] {
  try { const r = localStorage.getItem(PAYMENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function savePayments(list: Payment[]): void {
  localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(list));
  serverSync('payments', list);
}

// ── localStorage + server для механиков ──────────────────────────────────────
export const MECHANICS_STORAGE_KEY = 'app_mechanics';

const DEFAULT_MECHANICS: Mechanic[] = [
  { id: 'mech-1', name: 'Петров Иван Сергеевич', phone: '+7 900 000-00-01', status: 'active' },
  { id: 'mech-2', name: 'Орлов Михаил Андреевич', phone: '+7 900 000-00-02', status: 'active' },
];

export function loadMechanics(): Mechanic[] {
  try {
    const raw = localStorage.getItem(MECHANICS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Mechanic[];
  } catch { /* ignore */ }
  return DEFAULT_MECHANICS;
}

export function saveMechanics(list: Mechanic[]): void {
  localStorage.setItem(MECHANICS_STORAGE_KEY, JSON.stringify(list));
  serverSync('mechanics', list);
}

// ── localStorage + server для справочника работ сервиса ─────────────────────
export const SERVICE_WORK_CATALOG_KEY = 'app_service_work_catalog';

const DEFAULT_SERVICE_WORKS: ServiceWorkCatalogItem[] = [
  { id: 'wrk-1', name: 'Диагностика электрооборудования', normHours: 1.5, category: 'Диагностика', description: '', isActive: true, sortOrder: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'wrk-2', name: 'Замена гидравлического шланга', normHours: 2, category: 'Гидравлика', description: '', isActive: true, sortOrder: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'wrk-3', name: 'Регулировка концевиков', normHours: 1, category: 'Электрика', description: '', isActive: true, sortOrder: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export function loadServiceWorkCatalog(): ServiceWorkCatalogItem[] {
  try {
    const raw = localStorage.getItem(SERVICE_WORK_CATALOG_KEY);
    if (raw) return JSON.parse(raw) as ServiceWorkCatalogItem[];
  } catch { /* ignore */ }
  return DEFAULT_SERVICE_WORKS;
}

export function saveServiceWorkCatalog(list: ServiceWorkCatalogItem[]): void {
  localStorage.setItem(SERVICE_WORK_CATALOG_KEY, JSON.stringify(list));
  serverSync('service_works', list);
}

// ── localStorage + server для справочника запчастей ─────────────────────────
export const SPARE_PARTS_CATALOG_KEY = 'app_spare_parts_catalog';

const DEFAULT_SPARE_PARTS: SparePartCatalogItem[] = [
  { id: 'part-1', name: 'Гидравлический шланг 1/4"', article: 'HS-14', sku: 'HS-14', unit: 'шт', defaultPrice: 2800, category: 'Гидравлика', manufacturer: '', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'part-2', name: 'Концевой выключатель', article: 'LIM-SW', sku: 'LIM-SW', unit: 'шт', defaultPrice: 1900, category: 'Электрика', manufacturer: '', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'part-3', name: 'Предохранитель 24V', article: 'FUSE-24', sku: 'FUSE-24', unit: 'шт', defaultPrice: 250, category: 'Электрика', manufacturer: '', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export function loadSparePartsCatalog(): SparePartCatalogItem[] {
  try {
    const raw = localStorage.getItem(SPARE_PARTS_CATALOG_KEY);
    if (raw) return JSON.parse(raw) as SparePartCatalogItem[];
  } catch { /* ignore */ }
  return DEFAULT_SPARE_PARTS;
}

export function saveSparePartsCatalog(list: SparePartCatalogItem[]): void {
  localStorage.setItem(SPARE_PARTS_CATALOG_KEY, JSON.stringify(list));
  serverSync('spare_parts', list);
}

// ── localStorage + server для собственников техники ──────────────────────────

export interface Owner {
  id: string;
  name: string;
}

export const OWNERS_STORAGE_KEY = 'app_owners';

const DEFAULT_OWNERS: Owner[] = [
  { id: 'own-1', name: 'ООО «Скайтех компани»' },
  { id: 'own-2', name: 'Частный инвестор 1' },
  { id: 'own-3', name: 'Частный инвестор 2' },
  { id: 'own-4', name: 'Партнёрская техника' },
];

export function loadOwners(): Owner[] {
  try {
    const raw = localStorage.getItem(OWNERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Owner[];
  } catch { /* ignore */ }
  return DEFAULT_OWNERS;
}

export function saveOwners(list: Owner[]): void {
  localStorage.setItem(OWNERS_STORAGE_KEY, JSON.stringify(list));
  serverSync('owners', list);
}
