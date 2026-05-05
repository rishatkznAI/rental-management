import { api } from '../lib/api';
import type { PhotoReference, ServicePriority, ServiceScenario, ServiceStatus, ServiceTicket } from '../types';

export interface ServiceAuditLogEntry {
  id: string;
  serviceId: string;
  action: 'work_added' | 'work_deleted' | 'part_added' | 'part_deleted' | string;
  entityType: 'repair_work_item' | 'repair_part_item' | string;
  entityId: string;
  snapshot?: Record<string, unknown>;
  actor?: {
    id?: string | null;
    name?: string | null;
    role?: string | null;
  };
  source?: 'web' | 'api' | 'sync' | string;
  createdAt: string;
}

const SERVICE_STATUSES = new Set<ServiceStatus>(['new', 'in_progress', 'waiting_parts', 'needs_revision', 'ready', 'closed']);
const SERVICE_PRIORITIES = new Set<ServicePriority>(['critical', 'high', 'medium', 'low']);
const SERVICE_SCENARIOS = new Set<ServiceScenario>(['repair', 'to', 'chto', 'pto']);

const STATUS_ALIASES: Record<string, ServiceStatus> = {
  open: 'new',
  pending: 'new',
  created: 'new',
  progress: 'in_progress',
  inprogress: 'in_progress',
  in_progress: 'in_progress',
  waiting: 'waiting_parts',
  waitingparts: 'waiting_parts',
  waiting_parts: 'waiting_parts',
  needsrevision: 'needs_revision',
  needs_revision: 'needs_revision',
  revision: 'needs_revision',
  rework: 'needs_revision',
  done: 'closed',
  complete: 'closed',
  completed: 'closed',
  finished: 'closed',
};

const PRIORITY_ALIASES: Record<string, ServicePriority> = {
  urgent: 'critical',
  critical: 'critical',
  high: 'high',
  normal: 'medium',
  medium: 'medium',
  low: 'low',
};

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function dateValue(value: unknown): string {
  const text = stringValue(value);
  if (!text) return '';
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function enumKey(value: unknown): string {
  return stringValue(value)
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[\s-]+/g, '_');
}

function normalizeStatus(value: unknown): ServiceStatus {
  const key = enumKey(value);
  return SERVICE_STATUSES.has(key as ServiceStatus)
    ? key as ServiceStatus
    : STATUS_ALIASES[key] ?? 'new';
}

function normalizePriority(value: unknown): ServicePriority {
  const key = enumKey(value);
  return SERVICE_PRIORITIES.has(key as ServicePriority)
    ? key as ServicePriority
    : PRIORITY_ALIASES[key] ?? 'medium';
}

function normalizeScenario(value: unknown, reason: unknown): ServiceScenario {
  const explicit = enumKey(value);
  if (SERVICE_SCENARIOS.has(explicit as ServiceScenario)) return explicit as ServiceScenario;

  const reasonKey = enumKey(reason);
  if (reasonKey === 'то') return 'to';
  if (reasonKey === 'что') return 'chto';
  if (reasonKey === 'пто') return 'pto';
  return 'repair';
}

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function objectValue<T extends Record<string, unknown>>(value: unknown, fallback: T): T | Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fallback;
}

export function normalizeServiceTicketDto(value: unknown, index = 0): ServiceTicket | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = stringValue(item.id) || `legacy-service-${index + 1}`;
  const createdAt = dateValue(item.createdAt ?? item.created_at ?? item.date ?? item.openedAt);
  const updatedAt = dateValue(item.updatedAt ?? item.updated_at ?? item.modifiedAt) || createdAt;
  const inventoryNumber = stringValue(item.inventoryNumber ?? item.inventory ?? item.equipmentInv);
  const equipmentId = stringValue(item.equipmentId ?? item.equipment_id);
  const equipment = stringValue(item.equipment ?? item.equipmentName ?? item.equipmentTitle)
    || (inventoryNumber ? `INV: ${inventoryNumber}` : equipmentId);
  const reason = stringValue(item.reason ?? item.title ?? item.summary) || 'Без причины';
  const serviceKind = normalizeScenario(item.serviceKind ?? item.scenario ?? item.type, reason);
  const assignedMechanicId = stringValue(item.assignedMechanicId ?? item.mechanicId ?? item.assignedUserId);

  return {
    ...item,
    id,
    equipmentId,
    equipment,
    serviceKind,
    inventoryNumber,
    serialNumber: stringValue(item.serialNumber ?? item.serial) || undefined,
    equipmentType: stringValue(item.equipmentType) || undefined,
    equipmentTypeLabel: stringValue(item.equipmentTypeLabel) || undefined,
    location: stringValue(item.location) || undefined,
    reason,
    description: stringValue(item.description ?? item.comment ?? item.details),
    priority: normalizePriority(item.priority),
    sla: stringValue(item.sla),
    assignedTo: stringValue(item.assignedTo ?? item.responsibleName) || undefined,
    assignedMechanicId: assignedMechanicId || undefined,
    assignedMechanicName: stringValue(item.assignedMechanicName ?? item.mechanicName) || undefined,
    createdBy: stringValue(item.createdBy) || undefined,
    createdByUserId: stringValue(item.createdByUserId) || undefined,
    createdByUserName: stringValue(item.createdByUserName) || undefined,
    reporterContact: stringValue(item.reporterContact) || undefined,
    source: item.source as ServiceTicket['source'],
    status: normalizeStatus(item.status),
    plannedDate: stringValue(item.plannedDate) || undefined,
    closedAt: stringValue(item.closedAt) || undefined,
    result: stringValue(item.result) || undefined,
    resultData: objectValue(item.resultData, { summary: '', partsUsed: [], worksPerformed: [] }) as ServiceTicket['resultData'],
    repairPhotos: objectValue(item.repairPhotos, { before: [], after: [] }) as ServiceTicket['repairPhotos'],
    closeChecklist: item.closeChecklist as ServiceTicket['closeChecklist'],
    revisionHistory: arrayValue(item.revisionHistory) as ServiceTicket['revisionHistory'],
    revisionReason: stringValue(item.revisionReason) || undefined,
    revisionDetails: stringValue(item.revisionDetails) || undefined,
    revisionChecklist: arrayValue<string>(item.revisionChecklist),
    revisionReturnedAt: stringValue(item.revisionReturnedAt) || undefined,
    revisionReturnedBy: stringValue(item.revisionReturnedBy) || undefined,
    revisionReturnedByName: stringValue(item.revisionReturnedByName) || undefined,
    revisionPreviousStatus: stringValue(item.revisionPreviousStatus) || undefined,
    revisionResolvedAt: stringValue(item.revisionResolvedAt) || undefined,
    revisionResolvedBy: stringValue(item.revisionResolvedBy) || undefined,
    revisionResolvedByName: stringValue(item.revisionResolvedByName) || undefined,
    revisionResolutionComment: stringValue(item.revisionResolutionComment) || undefined,
    workLog: arrayValue(item.workLog) as ServiceTicket['workLog'],
    parts: arrayValue(item.parts) as ServiceTicket['parts'],
    createdAt,
    updatedAt,
    photos: arrayValue<PhotoReference>(item.photos),
    serviceVehicleId: stringValue(item.serviceVehicleId) || null,
  } as ServiceTicket;
}

export function normalizeServiceTicketList(value: unknown): ServiceTicket[] {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => normalizeServiceTicketDto(item, index))
    .filter((item): item is ServiceTicket => Boolean(item));
}

export const serviceTicketsService = {
  getAll: async (): Promise<ServiceTicket[]> =>
    normalizeServiceTicketList(await api.get<unknown>('/api/service')),

  getById: async (id: string): Promise<ServiceTicket | undefined> =>
    normalizeServiceTicketDto(await api.get<unknown>(`/api/service/${id}`).catch(() => undefined)) ?? undefined,

  getByEquipmentId: async (equipmentId: string): Promise<ServiceTicket[]> => {
    const all = await serviceTicketsService.getAll();
    return all.filter(t => t.equipmentId === equipmentId);
  },

  create: (data: Omit<ServiceTicket, 'id'>): Promise<ServiceTicket> =>
    api.post<ServiceTicket>('/api/service', data),

  update: (id: string, data: Partial<ServiceTicket>): Promise<ServiceTicket> =>
    api.patch<ServiceTicket>(`/api/service/${id}`, data),

  returnForRevision: (
    id: string,
    data: { reason: string; details?: string; checklist?: string[] },
  ): Promise<ServiceTicket> =>
    api.post<ServiceTicket>(`/api/service/${encodeURIComponent(id)}/revision`, data),

  resolveRevision: (
    id: string,
    data: { resolutionComment?: string } = {},
  ): Promise<ServiceTicket> =>
    api.post<ServiceTicket>(`/api/service/${encodeURIComponent(id)}/revision/resolve`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/service/${id}`),

  getAudit: (id: string): Promise<ServiceAuditLogEntry[]> =>
    api.get<ServiceAuditLogEntry[]>(`/api/service/${encodeURIComponent(id)}/audit`),

  bulkReplace: (list: ServiceTicket[]): Promise<void> =>
    api.put('/api/service', list),
};
