import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Equipment as EquipmentEntity, EquipmentSalePdiStatus } from '../../types';
import type { ActiveRentalIndex } from './equipment.types';

export type EquipmentMobileCardsProps = {
  equipmentItems: EquipmentEntity[];
  isSaleTab: boolean;
  activeRentalIndex: ActiveRentalIndex;
  selectedEquipmentId?: string | null;
  onSelectEquipment?: (equipment: EquipmentEntity) => void;
  renderSelectedQuickView?: (equipment: EquipmentEntity) => ReactNode;
  getEquipmentDetailPath: (equipment: EquipmentEntity) => string;
  getEquipmentTypeLabel: (equipment: EquipmentEntity) => string;
  getEquipmentDriveLabel: (drive: EquipmentEntity['drive']) => string;
  getRegistryStatusLabel: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getRegistryStatusAppearance: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getPriorityLabel: (priority: EquipmentEntity['priority']) => string;
  getPriorityAppearance: (priority: EquipmentEntity['priority']) => string;
  getRegistryOwnerLabel: (equipment: EquipmentEntity) => string;
  getEquipmentGsmDisplay: (equipment: EquipmentEntity) => {
    label: string;
    className: string;
    dotClassName: string;
  };
  getSalePdiAppearance: (status?: EquipmentSalePdiStatus) => string;
  isSaleRegistryEquipment: (equipment: EquipmentEntity) => boolean;
  salePdiLabels: Record<EquipmentSalePdiStatus, string>;
};

export function EquipmentMobileCards({
  equipmentItems,
  isSaleTab,
  activeRentalIndex,
  selectedEquipmentId,
  onSelectEquipment,
  renderSelectedQuickView,
  getEquipmentDetailPath,
  getEquipmentTypeLabel,
  getEquipmentDriveLabel,
  getRegistryStatusLabel,
  getRegistryStatusAppearance,
  getPriorityLabel,
  getPriorityAppearance,
  getRegistryOwnerLabel,
  getEquipmentGsmDisplay,
  getSalePdiAppearance,
  isSaleRegistryEquipment,
  salePdiLabels,
}: EquipmentMobileCardsProps) {
  return (
    <>
      {equipmentItems.map((equipment) => {
        const isSaleRecord = isSaleTab || isSaleRegistryEquipment(equipment);
        const detailPath = getEquipmentDetailPath(equipment);
        const equipmentTypeLabel = getEquipmentTypeLabel(equipment);
        const gsmDisplay = getEquipmentGsmDisplay(equipment);
        const isSelected = selectedEquipmentId === equipment.id;

        return (
          <Fragment key={equipment.id}>
            <div
              role={onSelectEquipment ? 'button' : undefined}
              tabIndex={onSelectEquipment ? 0 : undefined}
              onClick={() => onSelectEquipment?.(equipment)}
              onKeyDown={(event) => {
                if (!onSelectEquipment) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectEquipment(equipment);
                }
              }}
              className={`rounded-xl border bg-card/95 p-3.5 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)] ${
                isSelected ? 'border-primary/45 bg-primary/8 shadow-[inset_3px_0_0_var(--primary)]' : 'border-border/85'
              } ${onSelectEquipment ? 'cursor-pointer transition hover:border-primary/35 hover:bg-secondary/20 focus:outline-none focus:ring-2 focus:ring-primary/35' : ''}`}
              data-testid="equipment-mobile-card"
              data-equipment-id={equipment.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={detailPath} onClick={(event) => event.stopPropagation()} className="app-shell-title block break-words text-base font-extrabold text-foreground hover:text-primary">
                    {equipment.manufacturer} {equipment.model}
                  </Link>
                  <p className="mt-1 break-words text-xs text-foreground/58">
                    Инв. № {equipment.inventoryNumber || '—'} · SN {equipment.serialNumber || 'не указан'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getRegistryStatusAppearance(equipment, activeRentalIndex)}`}>
                      {getRegistryStatusLabel(equipment, activeRentalIndex)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getPriorityAppearance(equipment.priority)}`}>
                      {getPriorityLabel(equipment.priority)}
                    </span>
                    {isSaleRegistryEquipment(equipment) ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getSalePdiAppearance(equipment.salePdiStatus)}`}>
                        {salePdiLabels[equipment.salePdiStatus ?? 'not_started']}
                      </span>
                    ) : null}
                  </div>
                </div>
                {onSelectEquipment ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectEquipment(equipment);
                    }}
                    className="shrink-0 rounded-lg border border-border/80 bg-secondary/65 px-2.5 py-1.5 text-xs font-semibold text-foreground/68 transition hover:bg-secondary hover:text-foreground"
                  >
                    Действия
                  </button>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-foreground/60">
                <div className="min-w-0 break-words">Тип: <span className="text-foreground">{equipmentTypeLabel}</span></div>
                <div className="min-w-0 break-words">Привод: <span className="text-foreground">{getEquipmentDriveLabel(equipment.drive)}</span></div>
                <div className="col-span-2 min-w-0 break-words">Локация: <span className="text-foreground">{equipment.location || '—'}</span></div>
                <div className="min-w-0 break-words">Собственник: <span className="text-foreground">{getRegistryOwnerLabel(equipment)}</span></div>
                <div className="flex min-w-0 items-center gap-2">GSM:
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${gsmDisplay.className}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${gsmDisplay.dotClassName}`} />
                    {gsmDisplay.label}
                  </span>
                </div>
                <div className="col-span-2 min-w-0 break-words">След. ТО: <span className={new Date(equipment.nextMaintenance) < new Date() ? 'text-red-300' : 'text-foreground'}>{formatDate(equipment.nextMaintenance)}</span></div>
                {isSaleRecord ? (
                  <div className="col-span-2 min-w-0 break-words">
                    Цена 1: <span className="text-foreground">{formatCurrency(equipment.salePrice1 ?? 0)}</span>
                  </div>
                ) : (
                  <>
                    <div className="col-span-2 min-w-0 break-words">Клиент: <span className="text-foreground">{equipment.currentClient || '—'}</span></div>
                    <div className="col-span-2 min-w-0 break-words">Возврат: <span className="text-foreground">{equipment.returnDate ? formatDate(equipment.returnDate) : '—'}</span></div>
                  </>
                )}
              </div>
            </div>
            {isSelected && renderSelectedQuickView ? (
              <div className="min-w-0 overflow-hidden" data-testid="equipment-mobile-inline-quick-view">
                {renderSelectedQuickView(equipment)}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
