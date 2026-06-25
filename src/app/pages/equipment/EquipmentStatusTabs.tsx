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
    <div className="mt-2 -mx-2 flex gap-1 overflow-x-auto px-2 pb-1">
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
                : count === 0
                  ? 'border-border/45 bg-secondary/18 text-foreground/42 hover:border-border/70 hover:bg-secondary/45 hover:text-foreground/68'
                  : 'border-border/65 bg-secondary/30 text-foreground/60 hover:border-border hover:bg-secondary/62 hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
              activeTab === tab.key
                ? 'bg-primary/15 text-primary'
                : count === 0
                  ? 'bg-secondary/40 text-foreground/38'
                  : 'bg-secondary/85 text-foreground/56'
            }`}>
              {count > 99 ? '99+' : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
