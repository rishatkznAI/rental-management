"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { animationClasses } from "../../lib/animations";
import { cn } from "./utils";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "app-scroll-fade-x inline-flex h-10 max-w-full w-fit items-center justify-center overflow-x-auto rounded-lg border border-border bg-muted/70 p-[3px] text-muted-foreground flex",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "data-[state=active]:border-primary/30 data-[state=active]:bg-card data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring focus-visible:outline-ring inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color] duration-[var(--motion-duration-ui)] ease-[var(--motion-ease-standard)] hover:text-foreground focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(animationClasses.tabsContent, className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
