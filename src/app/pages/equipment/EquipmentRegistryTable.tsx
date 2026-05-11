import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Boxes, MoreVertical } from 'lucide-react';
import { photoSource } from '../../lib/media';
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1320px] table-fixed text-left text-sm">
        <thead className="border-b border-border bg-secondary/70 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <tr>
            <th className="w-[86px] px-4 py-3 font-medium">Фото</th>
            <th className="w-[150px] px-3 py-3 font-medium">Инв. номер</th>
            <th className="w-[210px] px-3 py-3 font-medium">Модель</th>
            <th className="w-[170px] px-3 py-3 font-medium">Тип / Привод</th>
            <th className="w-[135px] px-3 py-3 font-medium">Статус</th>
            <th className="w-[125px] px-3 py-3 font-medium">Категория</th>
            <th className="w-[145px] px-3 py-3 font-medium">Собственник</th>
            <th className="w-[150px] px-3 py-3 font-medium">Локация</th>
            <th className="w-[120px] px-3 py-3 font-medium">Приоритет</th>
            <th className="w-[120px] px-3 py-3 font-medium">GSM</th>
            <th className="w-[58px] px-3 py-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
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
                className={`cursor-pointer align-top transition-colors hover:bg-secondary/50 ${
                  selectedEquipmentId === equipment.id ? 'bg-primary/5' : ''
                }`}
                onClick={() => onSelectEquipment(equipment)}
              >
                <td className="px-4 py-3">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={title}
                      loading="lazy"
                      className="h-12 w-16 rounded-lg border border-border/70 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-secondary/70 text-muted-foreground" title="Нет фото">
                      <Boxes className="h-4 w-4" />
                      <span className="sr-only">Нет фото</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  <Link
                    to={detailPath}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-semibold text-foreground hover:text-primary"
                    title={equipment.inventoryNumber || '—'}
                  >
                    {equipment.inventoryNumber || '—'}
                  </Link>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    SN {equipment.serialNumber || 'не указан'}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Link to={detailPath} onClick={(event) => event.stopPropagation()} className="block truncate font-semibold text-foreground hover:text-primary">
                    {title}
                  </Link>
                  {equipment.year ? (
                    <div className="mt-1 text-xs text-muted-foreground">Год выпуска: {equipment.year}</div>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <div className="truncate text-foreground">{equipmentTypeLabel}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{driveLabel}</div>
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${getRegistryStatusAppearance(equipment, activeRentalIndex)}`}>
                    <span className="truncate">{getRegistryStatusLabel(equipment, activeRentalIndex)}</span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex max-w-full rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <span className="truncate">{getEquipmentCategoryLabel(equipment.category)}</span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="truncate text-foreground" title={ownerLabel}>{ownerLabel}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="truncate text-muted-foreground" title={equipment.location || '—'}>
                    {equipment.location || '—'}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                    <span className={`h-2 w-2 rounded-full ${getPriorityDotClass(equipment.priority)}`} />
                    {getPriorityLabel(equipment.priority)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${gsmDisplay.className}`}>
                    <span className={`h-2 w-2 rounded-full ${gsmDisplay.dotClassName}`} />
                    {gsmDisplay.label}
                  </span>
                </td>
                <td className="px-3 py-3">
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
