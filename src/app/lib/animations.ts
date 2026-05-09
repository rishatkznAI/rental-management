import { cn } from './utils';

export const animationDurations = {
  instant: 1,
  fast: 140,
  base: 180,
  relaxed: 220,
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
  compact: '1rem',
  default: '1.5rem',
  wide: '2rem',
} as const;

export const animationClasses = {
  overlay:
    'app-animate-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]',
  modal:
    'app-animate-modal fixed left-1/2 top-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg sm:max-w-lg',
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
