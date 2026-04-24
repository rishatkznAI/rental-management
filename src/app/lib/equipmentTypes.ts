import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appSettingsService } from '../services/app-settings.service';
import type { AppSetting, Equipment, EquipmentType } from '../types';

export const EQUIPMENT_TYPE_CATALOG_SETTING_KEY = 'equipment_type_catalog';

export interface EquipmentTypeCatalogItem {
  value: EquipmentType;
  label: string;
  isDefault?: boolean;
}

export const DEFAULT_EQUIPMENT_TYPE_CATALOG: EquipmentTypeCatalogItem[] = [
  { value: 'scissor', label: 'Ножничный', isDefault: true },
  { value: 'articulated', label: 'Коленчатый', isDefault: true },
  { value: 'telescopic', label: 'Телескопический', isDefault: true },
  { value: 'mast', label: 'Мачтовый', isDefault: true },
];

function cleanLabel(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function makeCustomEquipmentTypeValue(label: string): EquipmentType {
  return cleanLabel(label);
}

function normalizeCatalogItem(item: unknown): EquipmentTypeCatalogItem | null {
  if (typeof item === 'string') {
    const label = cleanLabel(item);
    return label ? { value: makeCustomEquipmentTypeValue(label), label } : null;
  }

  if (!item || typeof item !== 'object') return null;
  const candidate = item as Partial<EquipmentTypeCatalogItem>;
  const label = cleanLabel(candidate.label || candidate.value);
  const value = cleanLabel(candidate.value || label);
  if (!label || !value) return null;
  return {
    value,
    label,
    isDefault: Boolean(candidate.isDefault),
  };
}

export function normalizeEquipmentTypeCatalog(value: unknown): EquipmentTypeCatalogItem[] {
  const rawItems = Array.isArray(value)
    ? value
    : (
      value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : []
    );

  const savedItems = rawItems
    .map(normalizeCatalogItem)
    .filter((item): item is EquipmentTypeCatalogItem => Boolean(item));
  const savedByValue = new Map(savedItems.map(item => [item.value, item]));
  const seen = new Set<EquipmentType>();

  const catalog = DEFAULT_EQUIPMENT_TYPE_CATALOG.map(item => {
    seen.add(item.value);
    const saved = savedByValue.get(item.value);
    return {
      ...item,
      label: cleanLabel(saved?.label) || item.label,
      isDefault: true,
    };
  });

  for (const item of savedItems) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    catalog.push({
      ...item,
      isDefault: false,
    });
  }

  return catalog;
}

export function resolveEquipmentTypeCatalog(appSettings: AppSetting[]): EquipmentTypeCatalogItem[] {
  const setting = appSettings.find(item => item.key === EQUIPMENT_TYPE_CATALOG_SETTING_KEY);
  return normalizeEquipmentTypeCatalog(setting?.value);
}

export function findEquipmentTypeLabel(type: EquipmentType | string | null | undefined, catalog = DEFAULT_EQUIPMENT_TYPE_CATALOG) {
  const value = cleanLabel(type);
  if (!value) return '';
  return catalog.find(item => item.value === value)?.label || value;
}

export function mergeEquipmentTypesWithExistingEquipment(
  catalog: EquipmentTypeCatalogItem[],
  equipment: Partial<Equipment>[],
): EquipmentTypeCatalogItem[] {
  const seen = new Set(catalog.map(item => item.value));
  const result = [...catalog];
  for (const item of equipment) {
    const value = cleanLabel(item.type);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({ value, label: value, isDefault: false });
  }
  return result;
}

export function useEquipmentTypeCatalog() {
  const { data: appSettings = [] } = useQuery<AppSetting[]>({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
  });

  return useMemo(() => resolveEquipmentTypeCatalog(appSettings), [appSettings]);
}
