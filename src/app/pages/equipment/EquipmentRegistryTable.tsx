import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Boxes, MoreVertical } from 'lucide-react';
import { AuthenticatedImage } from '../../components/ui/AuthenticatedImage';
import { normalizePhotoReference, photoSource } from '../../lib/media';
import type { Equipment as EquipmentEntity } from '../../types';
import type { ActiveRentalIndex } from './equipment.types';

export type EquipmentRegistryTableProps = {
  equipmentItems: EquipmentEntity[];
  activeRentalIndex: ActiveRentalIndex;
  selectedEquipmentId: string | null;
  onSelectEquipment: (equipment: EquipmentEntity) => void;
  getEquipmentDetailPath: (equipment: EquipmentEntity) => string;
  getEquipmentTypeLabel: (equipment: EquipmentEntity) => string;
  getEquipmentDriveLabel: (drive: EquipmentEntity['drive']) => string;
  getRegistryStatusLabel: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getRegistryStatusAppearance: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getEquipmentCategoryLabel: (category: EquipmentEntity['category']) => string;
  getRegistryOwnerLabel: (equipment: EquipmentEntity) => string;
  getPriorityLabel: (priority: EquipmentEntity['priority']) => string;
  getPriorityDotClass: (priority: EquipmentEntity['priority']) => string;
  getEquipmentGsmDisplay: (equipment: EquipmentEntity) => {
    label: string;
    className: string;
    dotClassName: string;
  };
};

export function EquipmentRegistryTable({
  equipmentItems,
  activeRentalIndex,
  selectedEquipmentId,
  onSelectEquipment,
  getEquipmentDetailPath,
  getEquipmentTypeLabel,
  getEquipmentDriveLabel,
  getRegistryStatusLabel,
  getRegistryStatusAppearance,
  getEquipmentCategoryLabel,
  getRegistryOwnerLabel,
  getPriorityLabel,
  getPriorityDotClass,
  getEquipmentGsmDisplay,
}: EquipmentRegistryTableProps) {
  return (
    <div className="overflow-x-auto" data-testid="equipment-registry-table">
      <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="w-[72px] px-3 py-3 font-medium">Фото</th>
            <th className="w-[116px] px-2 py-3 font-medium">Инв. №</th>
            <th className="w-[170px] px-2 py-3 font-medium">Модель</th>
            <th className="w-[128px] px-2 py-3 font-medium">S/N</th>
            <th className="w-[118px] px-2 py-3 font-medium">Статус</th>
            <th className="w-[130px] px-2 py-3 font-medium">Локация</th>
            <th className="w-[130px] px-2 py-3 font-medium">Собственник</th>
            <th className="w-[112px] px-2 py-3 font-medium">Категория</th>
            <th className="w-[110px] px-2 py-3 font-medium">GSM</th>
            <th className="w-[112px] px-2 py-3 font-medium">Приоритет</th>
            <th className="w-[48px] px-2 py-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {equipmentItems.map((equipment) => {
            const detailPath = getEquipmentDetailPath(equipment);
            const imageSrc = photoSource(equipment.photo);
            const title = [equipment.manufacturer, equipment.model].filter(Boolean).join(' ') || 'Без модели';
            const equipmentTypeLabel = getEquipmentTypeLabel(equipment);
            const driveLabel = getEquipmentDriveLabel(equipment.drive);
            const ownerLabel = getRegistryOwnerLabel(equipment);
            const gsmDisplay = getEquipmentGsmDisplay(equipment);

            return (
              <tr
                key={equipment.id}
                className={`h-[70px] cursor-pointer align-middle transition-colors hover:bg-slate-50 ${
                  selectedEquipmentId === equipment.id ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200' : ''
                }`}
                onClick={() => onSelectEquipment(equipment)}
              >
                <td className="px-3 py-3">
                  {imageSrc ? (
                    <AuthenticatedImage
                      photo={normalizePhotoReference(equipment.photo, { idPrefix: `${equipment.id}-registry` })}
                      alt={title}
                      className="h-11 w-14 rounded-lg border border-slate-200"
                      imgClassName="h-full w-full object-cover"
                      fallbackClassName="h-12 min-h-0 w-16"
                    />
                  ) : (
                    <div className="flex h-11 w-14 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-400" title="Нет фото">
                      <Boxes className="h-4 w-4" />
                      <span className="sr-only">Нет фото</span>
                    </div>
                  )}
                </td>
                <td className="px-2 py-3">
                  <Link
                    to={detailPath}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-semibold text-foreground hover:text-primary"
                    title={equipment.inventoryNumber || '—'}
                  >
                    {equipment.inventoryNumber || '—'}
                  </Link>
                </td>
                <td className="px-2 py-3">
                  <Link to={detailPath} onClick={(event) => event.stopPropagation()} className="block truncate font-semibold text-foreground hover:text-primary">
                    {title}
                  </Link>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{equipmentTypeLabel}</div>
                </td>
                <td className="px-2 py-3">
                  <div className="truncate font-mono text-xs text-slate-600" title={equipment.serialNumber || 'не указан'}>
                    {equipment.serialNumber || 'не указан'}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{driveLabel}</div>
                </td>
                <td className="px-2 py-3">
                  <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${getRegistryStatusAppearance(equipment, activeRentalIndex)}`}>
                    <span className="truncate">{getRegistryStatusLabel(equipment, activeRentalIndex)}</span>
                  </span>
                </td>
                <td className="px-2 py-3">
                  <div className="truncate text-muted-foreground" title={equipment.location || '—'}>
                    {equipment.location || '—'}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="truncate text-foreground" title={ownerLabel}>{ownerLabel}</div>
                </td>
                <td className="px-2 py-3">
                  <span className="inline-flex max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    <span className="truncate">{getEquipmentCategoryLabel(equipment.category)}</span>
                  </span>
                </td>
                <td className="px-2 py-3">
                  <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${gsmDisplay.className}`}>
                    <span className={`h-2 w-2 rounded-full ${gsmDisplay.dotClassName}`} />
                    {gsmDisplay.label}
                  </span>
                </td>
                <td className="px-2 py-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    <span className={`h-2 w-2 rounded-full ${getPriorityDotClass(equipment.priority)}`} />
                    {getPriorityLabel(equipment.priority)}
                  </span>
                </td>
                <td className="px-2 py-3">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Действия по технике"
                        onClick={(event) => event.stopPropagation()}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="min-w-[180px] rounded-xl border border-border bg-popover p-1 shadow-xl"
                        sideOffset={5}
                        align="end"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenu.Item asChild className="cursor-pointer rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent">
                          <Link to={detailPath}>Открыть карточку</Link>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
