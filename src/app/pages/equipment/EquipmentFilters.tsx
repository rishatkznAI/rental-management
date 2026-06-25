import { Search } from 'lucide-react';
import { FilterButton, FilterDialog, FilterField } from '../../components/ui/filter-dialog';

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
  const inlineSelectClass = 'app-filter-input h-9 min-w-[128px] rounded-lg text-xs font-medium text-foreground/82';

  return (
    <>
      <div className="border-t border-border/45 bg-card/45 px-4 py-2.5 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Модель, инв. №, SN, собственник, локация…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="app-filter-input h-9 rounded-lg pl-10 text-sm font-medium text-foreground placeholder:text-foreground/42"
            />
          </div>
          <div className="hidden min-w-0 flex-nowrap items-center gap-1.5 xl:flex">
            <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)} className={inlineSelectClass} aria-label="Категория техники">
              <option value="all">Все категории</option>
              {categoryOptions.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
            <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className={inlineSelectClass} aria-label="Тип техники">
              {typeOptions.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <select value={driveFilter} onChange={(event) => onDriveFilterChange(event.target.value)} className={inlineSelectClass} aria-label="Привод техники">
              {driveOptions.map((drive) => (
                <option key={drive.value} value={drive.value}>{drive.label}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} className={inlineSelectClass} aria-label="Статус техники">
              {statusOptions.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            <select value={locationFilter} onChange={(event) => onLocationFilterChange(event.target.value)} className={inlineSelectClass} aria-label="Локация техники">
              <option value="all">Все локации</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2">
            {activeFilterCount > 0 ? (
              <button type="button" onClick={onReset} className="h-9 rounded-lg border border-border/80 bg-secondary/60 px-3 text-xs font-semibold text-foreground/65 transition hover:bg-secondary hover:text-foreground">
                Сбросить
              </button>
            ) : null}
            <FilterButton activeCount={activeFilterCount} onClick={() => onOpenChange(true)} />
          </div>
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
          <FilterField label="Статус">
            <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} className="app-filter-input">
              {statusOptions.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Тип">
            <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className="app-filter-input">
              {typeOptions.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Собственник">
            <select value={ownerFilter} onChange={(event) => onOwnerFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Все собственники</option>
              {ownerOptions.map((owner) => (
                <option key={owner.value} value={owner.value}>{owner.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Привод">
            <select value={driveFilter} onChange={(event) => onDriveFilterChange(event.target.value)} className="app-filter-input">
              {driveOptions.map((drive) => (
                <option key={drive.value} value={drive.value}>{drive.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Локация">
            <select value={locationFilter} onChange={(event) => onLocationFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Все локации</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="GSM">
            <select value={gsmFilter} onChange={(event) => onGsmFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Любой GSM</option>
              <option value="online">Онлайн</option>
              <option value="offline">Офлайн / нет связи</option>
              <option value="unknown">Нет данных</option>
            </select>
          </FilterField>
          <FilterField label="Приоритет">
            <select value={priorityFilter} onChange={(event) => onPriorityFilterChange(event.target.value)} className="app-filter-input">
              <option value="all">Любой приоритет</option>
              <option value="critical">Критический</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
          </FilterField>
        </div>
      </FilterDialog>
    </>
  );
}
