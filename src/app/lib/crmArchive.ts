import type { AppSetting } from '../types';

export const CRM_ARCHIVE_SETTING_KEY = 'crm_archive_state';
export const CRM_ARCHIVE_TTL_DAYS = 30;
export const CRM_ARCHIVE_TTL_MS = CRM_ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type CrmArchiveStatus = 'active' | 'archived' | 'deleted';

export interface CrmArchiveStateValue {
  status: CrmArchiveStatus;
  archivedAt?: string | null;
  deleteAfter?: string | null;
  archivedBy?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
  deletedAt?: string | null;
  purgedDealsCount?: number;
}

export interface ResolvedCrmArchiveState extends CrmArchiveStateValue {
  setting: AppSetting | null;
  isHidden: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  daysLeft: number | null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeStatus(value: unknown): CrmArchiveStatus {
  return value === 'archived' || value === 'deleted' || value === 'active' ? value : 'active';
}

export function getCrmArchiveSetting(appSettings: AppSetting[]) {
  return appSettings.find(item => item.key === CRM_ARCHIVE_SETTING_KEY) || null;
}

export function resolveCrmArchiveState(appSettings: AppSetting[]): ResolvedCrmArchiveState {
  const setting = getCrmArchiveSetting(appSettings);
  const raw = setting?.value && typeof setting.value === 'object' ? setting.value as Record<string, unknown> : {};
  const status = normalizeStatus(raw.status);
  const archivedAt = normalizeIso(raw.archivedAt);
  const deleteAfter = normalizeIso(raw.deleteAfter)
    || (archivedAt ? new Date(Date.parse(archivedAt) + CRM_ARCHIVE_TTL_MS).toISOString() : null);
  const deletedAt = normalizeIso(raw.deletedAt);

  const daysLeft = status === 'archived' && deleteAfter
    ? Math.max(0, Math.ceil((Date.parse(deleteAfter) - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    setting,
    status,
    archivedAt,
    deleteAfter,
    archivedBy: typeof raw.archivedBy === 'string' ? raw.archivedBy : null,
    restoredAt: normalizeIso(raw.restoredAt),
    restoredBy: typeof raw.restoredBy === 'string' ? raw.restoredBy : null,
    deletedAt,
    purgedDealsCount: typeof raw.purgedDealsCount === 'number' ? raw.purgedDealsCount : undefined,
    isHidden: status === 'archived' || status === 'deleted',
    isArchived: status === 'archived',
    isDeleted: status === 'deleted',
    daysLeft,
  };
}
