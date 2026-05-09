import * as React from 'react';
import { cn } from './utils';

export const animationDurations = {
  instant: 1,
  fast: 160,
  base: 220,
  relaxed: 260,
} as const;

export const animationEasings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  entrance: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const animationSpring = {
  duration: animationDurations.relaxed,
  easing: animationEasings.entrance,
} as const;

export const drawerOffset = {
  compact: '100%',
  default: '100%',
  wide: '100%',
} as const;

export type AnimationPresenceState = 'open' | 'closed';

export const animationClasses = {
  overlay:
    'app-animate-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]',
  modal:
    'app-animate-modal fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg',
  drawerBase:
    'app-animate-drawer fixed z-50 flex flex-col gap-4 bg-background shadow-lg will-change-transform',
  card: 'app-animate-section',
  section: 'app-animate-section',
  collapse: 'app-animate-collapse',
  popover: 'app-animate-popover',
  tabsContent: 'app-animate-tabs flex-1 outline-none',
  toast: 'app-animate-toast',
} as const;

export function animatedModalClassName(className?: string) {
  return cn(animationClasses.modal, className);
}

export function animatedOverlayClassName(className?: string) {
  return cn(animationClasses.overlay, className);
}

export function animatedDrawerClassName(className?: string) {
  return cn(animationClasses.drawerBase, className);
}

function getPresenceExitDelay(durationMs: number) {
  if (typeof window === 'undefined') return durationMs + 40;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 20;
  return durationMs + 40;
}

export function useAnimatedPresence(open: boolean, durationMs = animationDurations.base) {
  const [shouldRender, setShouldRender] = React.useState(open);
  const [dataState, setDataState] = React.useState<AnimationPresenceState>(open ? 'open' : 'closed');

  React.useEffect(() => {
    if (open) {
      setShouldRender(true);
      setDataState('open');
      return undefined;
    }

    if (!shouldRender) {
      setDataState('closed');
      return undefined;
    }

    setDataState('closed');
    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, getPresenceExitDelay(durationMs));

    return () => window.clearTimeout(timeout);
  }, [durationMs, open, shouldRender]);

  const onExitAnimationEnd = React.useCallback((event: React.AnimationEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target) return;
    if (!String(event.animationName).endsWith('-out')) return;
    if (!open) setShouldRender(false);
  }, [open]);

  return { shouldRender, dataState, onExitAnimationEnd } as const;
}
