import { Link } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Boxes, Check, MoreVertical } from 'lucide-react';
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
    <div className="app-scroll-fade-x min-w-0 overflow-x-auto">
      <table className="w-full min-w-[1480px] table-fixed border-separate border-spacing-0 text-left text-sm text-foreground">
        <thead className="sticky top-0 z-10 border-b border-border/90 bg-card/96 text-[10px] uppercase tracking-[0.14em] text-foreground/60 backdrop-blur">
          <tr>
            <th className="w-[52px] px-4 py-3 font-medium">Выбор</th>
            <th className="w-[82px] px-3 py-3 font-medium">Фото</th>
            <th className="w-[150px] px-3 py-3 font-medium">Инв. номер</th>
            <th className="w-[210px] px-3 py-3 font-medium">Модель</th>
            <th className="w-[170px] px-3 py-3 font-medium">Тип / Привод</th>
            <th className="w-[135px] px-3 py-3 font-medium">Статус</th>
            <th className="w-[125px] px-3 py-3 font-medium">Категория</th>
            <th className="w-[145px] px-3 py-3 font-medium">Собственник</th>
            <th className="w-[150px] px-3 py-3 font-medium">Локация</th>
            <th className="w-[170px] px-3 py-3 font-medium">Клиент / объект</th>
            <th className="w-[120px] px-3 py-3 font-medium">GSM</th>
            <th className="w-[120px] px-3 py-3 font-medium">Приоритет</th>
            <th className="w-[58px] px-3 py-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
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
                className={`cursor-pointer align-top transition-colors ${
                  selectedEquipmentId === equipment.id ? 'bg-primary/7 shadow-[inset_3px_0_0_var(--primary)]' : 'bg-card/20 hover:bg-secondary/42'
                }`}
                onClick={() => onSelectEquipment(equipment)}
              >
                <td className="border-b border-border/75 px-4 py-3">
                  <button
                    type="button"
                    aria-label={selectedEquipmentId === equipment.id ? 'Техника выбрана' : 'Выбрать технику'}
                    className={`flex h-5 w-5 items-center justify-center rounded border transition ${
                      selectedEquipmentId === equipment.id
                        ? 'border-primary/80 bg-primary/90 text-primary-foreground'
                        : 'border-border/90 bg-secondary/45 text-transparent hover:border-primary/55 hover:bg-secondary/70'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectEquipment(equipment);
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  {imageSrc ? (
                    <AuthenticatedImage
                      photo={normalizePhotoReference(equipment.photo, { idPrefix: `${equipment.id}-registry` })}
                      alt={title}
                      className="h-12 w-16 rounded-lg border border-border/70"
                      imgClassName="h-full w-full object-cover"
                      fallbackClassName="h-12 min-h-0 w-16"
                    />
                  ) : (
                    <div className="flex h-12 w-16 items-center justify-center rounded-lg border border-border/75 bg-[linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] text-foreground/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" title="Нет фото">
                      <Boxes className="h-4 w-4" />
                      <span className="sr-only">Нет фото</span>
                    </div>
                  )}
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <Link
                    to={detailPath}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-semibold text-foreground hover:text-primary"
                    title={equipment.inventoryNumber || '—'}
                  >
                    {equipment.inventoryNumber || '—'}
                  </Link>
                  <div className="mt-1 truncate text-xs text-foreground/58">
                    SN {equipment.serialNumber || 'не указан'}
                  </div>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <Link to={detailPath} onClick={(event) => event.stopPropagation()} className="block truncate font-semibold text-foreground hover:text-primary" title={title}>
                    {title}
                  </Link>
                  {equipment.year ? (
                    <div className="mt-1 text-xs text-foreground/58">Год выпуска: {equipment.year}</div>
                  ) : null}
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <div className="truncate text-foreground">{equipmentTypeLabel}</div>
                  <div className="mt-1 truncate text-xs text-foreground/58">{driveLabel}</div>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${getRegistryStatusAppearance(equipment, activeRentalIndex)}`}>
                    <span className="truncate">{getRegistryStatusLabel(equipment, activeRentalIndex)}</span>
                  </span>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <span className="inline-flex max-w-full rounded-full border border-border/70 bg-secondary/75 px-2.5 py-1 text-xs font-medium text-foreground/68">
                    <span className="truncate">{getEquipmentCategoryLabel(equipment.category)}</span>
                  </span>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <div className="truncate text-foreground" title={ownerLabel}>{ownerLabel}</div>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <div className="truncate text-foreground/68" title={equipment.location || '—'}>
                    {equipment.location || '—'}
                  </div>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <div className="truncate text-foreground" title={equipment.currentClient || '—'}>
                    {equipment.currentClient || '—'}
                  </div>
                  {equipment.returnDate ? (
                    <div className="mt-1 truncate text-xs text-foreground/58">Возврат: {equipment.returnDate}</div>
                  ) : null}
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${gsmDisplay.className}`}>
                    <span className={`h-2 w-2 rounded-full ${gsmDisplay.dotClassName}`} />
                    {gsmDisplay.label}
                  </span>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/75 px-2.5 py-1 text-xs font-medium text-foreground">
                    <span className={`h-2 w-2 rounded-full ${getPriorityDotClass(equipment.priority)}`} />
                    {getPriorityLabel(equipment.priority)}
                  </span>
                </td>
                <td className="border-b border-border/75 px-3 py-3">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label="Действия по технике"
                        onClick={(event) => event.stopPropagation()}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 transition hover:bg-secondary hover:text-foreground"
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
