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
    <div className="mt-3 -mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1">
      {tabs.map((tab) => {
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === tab.key
                ? 'border-primary/35 bg-primary/12 text-foreground'
                : 'border-border/70 bg-secondary/38 text-foreground/62 hover:border-border hover:bg-secondary/70 hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
              activeTab === tab.key ? 'bg-primary/15 text-primary' : 'bg-secondary/90 text-foreground/58'
            }`}>
              {count > 99 ? '99+' : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
