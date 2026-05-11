import { Link } from 'react-router-dom';
import type { EquipmentPreviewQuickAction } from './equipment.types';

export type { EquipmentPreviewQuickAction } from './equipment.types';

export type EquipmentQuickActionsProps = {
  actions: EquipmentPreviewQuickAction[];
};

export function EquipmentQuickActions({ actions }: EquipmentQuickActionsProps) {
  if (actions.length === 0) return null;

  const toneClassName: Record<NonNullable<EquipmentPreviewQuickAction['tone']>, string> = {
    primary: 'border-primary/35 bg-primary/15 text-primary hover:bg-primary/20',
    default: 'border-border bg-secondary/70 text-foreground hover:bg-secondary',
    danger: 'border-red-500/25 bg-red-500/10 text-red-200 hover:bg-red-500/15',
  };

  return (
    <section className="mb-5 rounded-xl border border-border bg-card/70 p-3">
      <h3 className="text-sm font-semibold text-foreground">Быстрые действия</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const disabled = Boolean(action.disabled || (!action.to && !action.onClick));
          const className = disabled
            ? 'cursor-not-allowed border-border bg-secondary/35 text-muted-foreground opacity-80'
            : toneClassName[action.tone || 'default'];
          const content = (
            <>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{action.label}</span>
                {disabled && action.reason ? (
                  <span className="mt-0.5 block whitespace-normal text-left text-[11px] font-normal leading-snug text-muted-foreground">
                    {action.reason}
                  </span>
                ) : null}
              </span>
            </>
          );
          const baseClassName = `flex min-h-11 w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${className}`;

          if (action.to && !disabled) {
            return (
              <Link key={action.id} to={action.to} className={baseClassName}>
                {content}
              </Link>
            );
          }

          return (
            <button
              key={action.id}
              type="button"
              className={baseClassName}
              onClick={disabled ? undefined : action.onClick}
              disabled={disabled}
              title={action.reason || undefined}
            >
              {content}
            </button>
          );
        })}
      </div>
    </section>
  );
}
