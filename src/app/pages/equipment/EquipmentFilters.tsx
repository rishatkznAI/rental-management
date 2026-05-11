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
      <div className="px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Модель, инв. №, SN, собственник, локация…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="app-filter-input pl-10"
            />
          </div>
          <FilterButton activeCount={activeFilterCount} onClick={() => onOpenChange(true)} />
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
        </div>
      </FilterDialog>
    </>
  );
}
