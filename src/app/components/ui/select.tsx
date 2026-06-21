"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";

import { animationClasses, animationDurations, useAnimatedPresence } from "../../lib/animations";
import { cn } from "./utils";

type SelectMotionContextValue = ReturnType<typeof useAnimatedPresence>;

const SelectMotionContext = React.createContext<SelectMotionContextValue | null>(null);
type SelectLabelContextValue = {
  selectedValue: string;
  labels: Map<string, string>;
  registerLabel: (value: string, label: string) => void;
};

const SelectLabelContext = React.createContext<SelectLabelContextValue | null>(null);

function normalizeSelectValue(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function getNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return getNodeText(node.props.children);
  return "";
}

function Select({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const normalizedValue = normalizeSelectValue(value);
  const normalizedDefaultValue = normalizeSelectValue(defaultValue);
  const [internalValue, setInternalValue] = React.useState(normalizedDefaultValue ?? "");
  const selectedValue = normalizedValue ?? internalValue;
  const [labels, setLabels] = React.useState(() => new Map<string, string>());
  const [radixOpen, setRadixOpen] = React.useState(Boolean(defaultOpen));
  const [visualOpen, setVisualOpen] = React.useState(Boolean(defaultOpen));
  const isControlled = controlledOpen !== undefined;
  const requestedOpen = isControlled ? Boolean(controlledOpen) : radixOpen;
  const presence = useAnimatedPresence(visualOpen, animationDurations.fast);

  const registerLabel = React.useCallback((itemValue: string, label: string) => {
    const normalizedLabel = label.trim();
    if (!itemValue || !normalizedLabel) return;
    setLabels(current => {
      if (current.get(itemValue) === normalizedLabel) return current;
      const next = new Map(current);
      next.set(itemValue, normalizedLabel);
      return next;
    });
  }, []);

  const handleValueChange = React.useCallback((nextValue: string) => {
    setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }, [onValueChange]);

  const labelContextValue = React.useMemo(() => ({
    selectedValue,
    labels,
    registerLabel,
  }), [labels, registerLabel, selectedValue]);

  React.useEffect(() => {
    if (requestedOpen) {
      setRadixOpen(true);
      setVisualOpen(true);
      return undefined;
    }

    setVisualOpen(false);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(() => {
      setRadixOpen(false);
    }, reduceMotion ? 20 : animationDurations.fast + 40);
    return () => window.clearTimeout(timeout);
  }, [requestedOpen]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setRadixOpen(true);
      setVisualOpen(true);
    } else {
      setVisualOpen(false);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => setRadixOpen(false), reduceMotion ? 20 : animationDurations.fast + 40);
    }
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  return (
    <SelectMotionContext.Provider value={presence}>
      <SelectLabelContext.Provider value={labelContextValue}>
        <SelectPrimitive.Root
          data-slot="select"
          open={radixOpen}
          onOpenChange={handleOpenChange}
          value={normalizedValue}
          defaultValue={normalizedDefaultValue}
          onValueChange={handleValueChange}
          {...props}
        />
      </SelectLabelContext.Provider>
    </SelectMotionContext.Provider>
  );
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const labelContext = React.useContext(SelectLabelContext);
  const selectedLabel = labelContext?.selectedValue ? labelContext.labels.get(labelContext.selectedValue) : undefined;
  return (
    <SelectPrimitive.Value data-slot="select-value" {...props}>
      {children ?? selectedLabel}
    </SelectPrimitive.Value>
  );
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex w-full items-center justify-between gap-2 rounded-xl border bg-input-background px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow,border-color,background-color] outline-none hover:border-primary/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-10 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const presence = React.useContext(SelectMotionContext);
  if (presence && !presence.shouldRender) return null;

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-state={presence?.dataState}
        className={cn(
          "bg-popover text-popover-foreground relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-border shadow-[0_28px_70px_-46px_rgba(0,0,0,0.72)]",
          animationClasses.popover,
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        onAnimationEnd={presence?.onExitAnimationEnd}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const labelContext = React.useContext(SelectLabelContext);
  const normalizedValue = normalizeSelectValue(value) ?? "";
  const label = getNodeText(children);

  React.useEffect(() => {
    labelContext?.registerLabel(normalizedValue, label);
  }, [label, labelContext, normalizedValue]);

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      value={normalizedValue}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
