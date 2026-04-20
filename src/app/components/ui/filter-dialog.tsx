import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { cn } from './utils';

type FilterButtonProps = React.ComponentProps<typeof Button> & {
  activeCount?: number;
  label?: string;
};

export function FilterButton({
  activeCount = 0,
  label = 'Фильтры',
  className,
  children,
  ...props
}: FilterButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn('rounded-xl border border-border bg-secondary/80 px-4 text-sm text-foreground', className)}
      {...props}
    >
      {children ?? (
        <>
          <SlidersHorizontal className="h-4 w-4" />
          {label}
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {activeCount}
            </span>
          )}
        </>
      )}
    </Button>
  );
}

type FilterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onReset?: () => void;
  resetLabel?: string;
  doneLabel?: string;
  className?: string;
  children: React.ReactNode;
};

export function FilterDialog({
  open,
  onOpenChange,
  title,
  description,
  onReset,
  resetLabel = 'Сбросить',
  doneLabel = 'Готово',
  className,
  children,
}: FilterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('app-filter-dialog sm:max-w-[760px]', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-5">{children}</div>

        <DialogFooter>
          {onReset ? (
            <Button type="button" variant="secondary" onClick={onReset}>
              {resetLabel}
            </Button>
          ) : null}
          <Button type="button" onClick={() => onOpenChange(false)}>
            {doneLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('app-filter-field', className)}>
      <div className="app-filter-label">{label}</div>
      {children}
    </div>
  );
}
