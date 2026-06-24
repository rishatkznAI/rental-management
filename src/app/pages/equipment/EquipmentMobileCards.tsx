import { formatCurrency, formatDate } from '../../lib/utils';
import type { Equipment as EquipmentEntity, EquipmentSalePdiStatus } from '../../types';
import type { ActiveRentalIndex } from './equipment.types';

export type EquipmentMobileCardsProps = {
  equipmentItems: EquipmentEntity[];
  isSaleTab: boolean;
  activeRentalIndex: ActiveRentalIndex;
  selectedEquipmentId: string | null;
  onSelectEquipment: (equipment: EquipmentEntity) => void;
  getEquipmentDetailPath: (equipment: EquipmentEntity) => string;
  getEquipmentTypeLabel: (equipment: EquipmentEntity) => string;
  getEquipmentDriveLabel: (drive: EquipmentEntity['drive']) => string;
  getRegistryStatusLabel: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getRegistryStatusAppearance: (equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) => string;
  getPriorityLabel: (priority: EquipmentEntity['priority']) => string;
  getPriorityAppearance: (priority: EquipmentEntity['priority']) => string;
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
  getEquipmentDetailPath,
  getEquipmentTypeLabel,
  getEquipmentDriveLabel,
  getRegistryStatusLabel,
  getRegistryStatusAppearance,
  getPriorityLabel,
  getPriorityAppearance,
  getSalePdiAppearance,
  isSaleRegistryEquipment,
  salePdiLabels,
}: EquipmentMobileCardsProps) {
  return (
    <>
      {equipmentItems.map((equipment) => {
        const isSaleRecord = isSaleTab || isSaleRegistryEquipment(equipment);
        getEquipmentDetailPath(equipment);
        const equipmentTypeLabel = getEquipmentTypeLabel(equipment);

        return (
          <button
            key={equipment.id}
            type="button"
            onClick={() => onSelectEquipment(equipment)}
            className={`w-full rounded-xl border bg-white p-4 text-left shadow-[0_16px_34px_-30px_rgba(15,23,42,0.55)] transition hover:border-blue-200 ${
              selectedEquipmentId === equipment.id ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="app-shell-title block break-words text-base font-extrabold text-foreground">
                  {equipment.manufacturer} {equipment.model}
                </span>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  Инв. № {equipment.inventoryNumber || '—'} · SN {equipment.serialNumber || 'не указан'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
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
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
              <div className="min-w-0 break-words">Тип: <span className="text-foreground">{equipmentTypeLabel}</span></div>
              <div className="min-w-0 break-words">Привод: <span className="text-foreground">{getEquipmentDriveLabel(equipment.drive)}</span></div>
              <div className="min-w-0 break-words">Локация: <span className="text-foreground">{equipment.location || '—'}</span></div>
              <div className="min-w-0 break-words">След. ТО: <span className={new Date(equipment.nextMaintenance) < new Date() ? 'text-red-300' : 'text-foreground'}>{formatDate(equipment.nextMaintenance)}</span></div>
              {isSaleRecord ? (
                <div className="min-w-0 break-words">
                  Цена 1: <span className="text-foreground">{formatCurrency(equipment.salePrice1 ?? 0)}</span>
                </div>
              ) : (
                <>
                  <div className="min-w-0 break-words">Клиент: <span className="text-foreground">{equipment.currentClient || '—'}</span></div>
                  <div className="min-w-0 break-words">Возврат: <span className="text-foreground">{equipment.returnDate ? formatDate(equipment.returnDate) : '—'}</span></div>
                </>
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}
