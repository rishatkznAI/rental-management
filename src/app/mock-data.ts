import { Equipment, Rental, ServiceTicket, Client, Document, Payment, RepairRecord, ShippingPhoto } from './types';

// ========== Пустая база данных ==========
// Добавляйте свои данные через интерфейс приложения

export const mockEquipment: Equipment[] = [];

// ── localStorage для техники ──────────────────────────────────────────────────
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
}

export const mockRepairRecords: RepairRecord[] = [];

export const mockShippingPhotos: ShippingPhoto[] = [];

export const mockRentals: Rental[] = [];

// ── localStorage для аренд ────────────────────────────────────────────────────
export const RENTALS_STORAGE_KEY = 'app_rentals';
export function loadRentals(): Rental[] {
  try { const r = localStorage.getItem(RENTALS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveRentals(list: Rental[]): void {
  localStorage.setItem(RENTALS_STORAGE_KEY, JSON.stringify(list));
}

export const mockServiceTickets: ServiceTicket[] = [];

// ── localStorage для сервисных заявок ─────────────────────────────────────────
export const SERVICE_STORAGE_KEY = 'app_service_tickets';
export function loadServiceTickets(): ServiceTicket[] {
  try { const r = localStorage.getItem(SERVICE_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveServiceTickets(list: ServiceTicket[]): void {
  localStorage.setItem(SERVICE_STORAGE_KEY, JSON.stringify(list));
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

// ── localStorage для Gantt-аренд ──────────────────────────────────────────────
export const GANTT_RENTALS_STORAGE_KEY = 'app_gantt_rentals';
export function loadGanttRentals(): GanttRentalData[] {
  try { const r = localStorage.getItem(GANTT_RENTALS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveGanttRentals(list: GanttRentalData[]): void {
  localStorage.setItem(GANTT_RENTALS_STORAGE_KEY, JSON.stringify(list));
}

export const mockDowntimes: DowntimePeriod[] = [];

export const mockServicePeriods: ServicePeriod[] = [];

// ── localStorage для фото отгрузок/приёмки ────────────────────────────────────
export const SHIPPING_PHOTOS_KEY = 'app_shipping_photos';
export function loadShippingPhotos(): ShippingPhoto[] {
  try { const r = localStorage.getItem(SHIPPING_PHOTOS_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveShippingPhotos(list: ShippingPhoto[]): void {
  localStorage.setItem(SHIPPING_PHOTOS_KEY, JSON.stringify(list));
}

export const mockClients: Client[] = [];

// ── localStorage для клиентов ─────────────────────────────────────────────────
export const CLIENTS_STORAGE_KEY = 'app_clients';
export function loadClients(): Client[] {
  try { const r = localStorage.getItem(CLIENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveClients(list: Client[]): void {
  localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(list));
}

export const mockDocuments: Document[] = [];

// ── localStorage для документов ───────────────────────────────────────────────
export const DOCUMENTS_STORAGE_KEY = 'app_documents';
export function loadDocuments(): Document[] {
  try { const r = localStorage.getItem(DOCUMENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function saveDocuments(list: Document[]): void {
  localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(list));
}

export const mockPayments: Payment[] = [];

// ── localStorage для платежей ─────────────────────────────────────────────────
export const PAYMENTS_STORAGE_KEY = 'app_payments';
export function loadPayments(): Payment[] {
  try { const r = localStorage.getItem(PAYMENTS_STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
export function savePayments(list: Payment[]): void {
  localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(list));
}

// ── localStorage для собственников техники ────────────────────────────────────

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
}
