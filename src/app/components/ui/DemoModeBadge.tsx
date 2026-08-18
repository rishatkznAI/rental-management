const DEMO_MODE_ENABLED = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true' ||
  String(import.meta.env.VITE_DEMO_MODE || '') === '1';

export function DemoModeBadge() {
  if (!DEMO_MODE_ENABLED) return null;

  return (
    <div
      className="fixed left-1/2 top-2 z-[1000] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-950 shadow-lg sm:left-auto sm:right-3 sm:top-3 sm:translate-x-0 sm:px-3 sm:py-2 sm:text-xs dark:border-amber-500/60 dark:bg-amber-950 dark:text-amber-100"
      data-testid="demo-mode-badge"
      role="status"
      aria-label="Демо-режим"
    >
      <div>DEMO MODE</div>
      <div className="sr-only font-normal sm:not-sr-only sm:block">Демо-режим · данные будут сброшены</div>
    </div>
  );
}
