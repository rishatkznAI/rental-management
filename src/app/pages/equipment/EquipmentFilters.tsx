import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { FilterDialog, FilterField } from '../../components/ui/filter-dialog';

export type EquipmentFilterOption = {
  value: string;
  label: string;
};

type EquipmentFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
  activeFilterCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  fleetFilter: string;
  onFleetFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  ownerFilter: string;
  onOwnerFilterChange: (value: string) => void;
  driveFilter: string;
  onDriveFilterChange: (value: string) => void;
  locationFilter: string;
  onLocationFilterChange: (value: string) => void;
  gsmFilter: string;
  onGsmFilterChange: (value: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (value: string) => void;
  categoryOptions: EquipmentFilterOption[];
  statusOptions: EquipmentFilterOption[];
  typeOptions: EquipmentFilterOption[];
  ownerOptions: EquipmentFilterOption[];
  driveOptions: EquipmentFilterOption[];
  locationOptions: string[];
  activeFleetLabels: { yes: string; no: string };
};

export function EquipmentFilters({
  search,
  onSearchChange,
  activeFilterCount,
  open,
  onOpenChange,
  onReset,
  categoryFilter,
  onCategoryFilterChange,
  fleetFilter,
  onFleetFilterChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  ownerFilter,
  onOwnerFilterChange,
  driveFilter,
  onDriveFilterChange,
  locationFilter,
  onLocationFilterChange,
  gsmFilter,
  onGsmFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  categoryOptions,
  statusOptions,
  typeOptions,
  ownerOptions,
  driveOptions,
  locationOptions,
  activeFleetLabels,
}: EquipmentFiltersProps) {
  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.5)] sm:px-4" data-testid="equipment-filter-panel">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(220px,1.4fr)_150px_170px_170px_170px_130px_130px_auto_auto]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Поиск техники"
              placeholder="Модель, S/N, инв. №"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="app-filter-input h-10 bg-slate-50 pl-10"
            />
          </div>
          <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="Статус техники">
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="Тип техники">
            {typeOptions.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          <select value={ownerFilter} onChange={(event) => onOwnerFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="Собственник">
            <option value="all">Все собственники</option>
            {ownerOptions.map((owner) => (
              <option key={owner.value} value={owner.value}>{owner.label}</option>
            ))}
          </select>
          <select value={locationFilter} onChange={(event) => onLocationFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="Локация">
            <option value="all">Все локации</option>
            {locationOptions.map((location) => (
              <option key={location} value={location}>{location}</option>
            ))}
          </select>
          <select value={gsmFilter} onChange={(event) => onGsmFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="GSM">
            <option value="all">GSM: все</option>
            <option value="online">Онлайн</option>
            <option value="offline">Офлайн</option>
            <option value="none">Нет трекера</option>
          </select>
          <select value={priorityFilter} onChange={(event) => onPriorityFilterChange(event.target.value)} className="app-filter-input h-10 bg-slate-50" aria-label="Приоритет">
            <option value="all">Приоритет</option>
            <option value="high">Высокий</option>
            <option value="medium">Средний</option>
            <option value="low">Низкий</option>
          </select>
          <Button type="button" variant="outline" className="h-10 rounded-lg px-3" onClick={() => onOpenChange(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Ещё
            {activeFilterCount > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{activeFilterCount}</span> : null}
          </Button>
          <Button type="button" variant="ghost" className="h-10 rounded-lg px-3" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Сбросить
          </Button>
        </div>
      </div>

      <FilterDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Фильтры техники"
        description="Настрой выборку парка по поиску, статусу, типу, собственнику и локации."
        onReset={onReset}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FilterField label="Категория">
            <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Все категории</option>
              {categoryOptions.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Активный парк">
            <select value={fleetFilter} onChange={(event) => onFleetFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Любое участие в парке</option>
              <option value="true">{`Активный парк — ${activeFleetLabels.yes}`}</option>
              <option value="false">{`Активный парк — ${activeFleetLabels.no}`}</option>
            </select>
          </FilterField>
          <FilterField label="Привод">
            <select value={driveFilter} onChange={(event) => onDriveFilterChange(event.target.value)} className="app-filter-input">
              {driveOptions.map((drive) => (
                <option key={drive.value} value={drive.value}>{drive.label}</option>
              ))}
            </select>
          </FilterField>
        </div>
      </FilterDialog>
    </>
  );
}
