import type { EquipmentTab } from './equipment.types';

type EquipmentStatusTabsProps = {
  activeTab: EquipmentTab;
  tabs: Array<{ key: EquipmentTab; label: string }>;
  counts: Record<EquipmentTab, number>;
  onTabChange: (tab: EquipmentTab) => void;
};

export function EquipmentStatusTabs({
  activeTab,
  tabs,
  counts,
  onTabChange,
}: EquipmentStatusTabsProps) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`rounded-xl border px-4 py-2 text-sm transition-colors ${
              activeTab === tab.key
                ? 'border-primary/30 bg-accent text-foreground'
                : 'border-transparent bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
              activeTab === tab.key ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
            }`}>
              {count > 99 ? '99+' : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
