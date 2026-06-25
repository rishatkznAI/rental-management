import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type EquipmentTab = 'all' | 'available' | 'rented' | 'service' | 'reserved' | 'written_off' | 'for_sale' | 'sold';

export type EquipmentRegistryStatusKind = 'available' | 'rented' | 'reserved' | 'service' | 'written_off' | 'for_sale' | 'sold';

export type ActiveRentalIndex = {
  equipmentIds: Set<string>;
  uniqueInventoryNumbers: Set<string>;
};

export type EquipmentTypeOptions = Array<{ value: string; label: string }>;

export type EquipmentPreviewTab = 'overview' | 'specs' | 'documents' | 'history' | 'gsm';

export type EquipmentPreviewQuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  tone?: 'primary' | 'default' | 'danger';
};

export type EquipmentPreviewField = {
  label: string;
  value: ReactNode;
};

export type EquipmentPreviewDocumentSlot = {
  label: string;
  count: number;
};

export type EquipmentPreviewDocument = {
  id: string;
  typeLabel: string;
  number: string;
  dateLabel: string;
};

export type EquipmentPreviewPhoto = {
  id: string;
  label: string;
  src: string;
  metaLabel: string;
};

export type EquipmentPreviewTimelineItem = {
  id: string;
  title: string;
  description: string;
  dateLabel: string;
};

export type EquipmentQuickViewPanelData = {
  title: string;
  detailPath: string;
  mainPhoto?: string;
  statusLabel: string;
  statusClassName: string;
  inventoryNumber?: string;
  serialNumber?: string;
  quickActions: EquipmentPreviewQuickAction[];
  overviewFields: EquipmentPreviewField[];
  specFields: EquipmentPreviewField[];
  canViewDocuments: boolean;
  documentSlots: EquipmentPreviewDocumentSlot[];
  documents: EquipmentPreviewDocument[];
  docsPath: string;
  canViewPhotos: boolean;
  photos: EquipmentPreviewPhoto[];
  timeline: EquipmentPreviewTimelineItem[];
};

export type EquipmentEmptyStateConfig = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
};
