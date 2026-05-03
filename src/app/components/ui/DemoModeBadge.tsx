const DEMO_MODE_ENABLED = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true' ||
  String(import.meta.env.VITE_DEMO_MODE || '') === '1';

export function DemoModeBadge() {
  if (!DEMO_MODE_ENABLED) return null;

  return (
    <div
      className="fixed right-3 top-3 z-[1000] rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 shadow-lg dark:border-amber-500/60 dark:bg-amber-950 dark:text-amber-100"
      data-testid="demo-mode-badge"
      role="status"
      aria-label="Демо-режим"
    >
      <div>DEMO MODE</div>
      <div className="font-normal">Демо-режим · данные будут сброшены</div>
    </div>
  );
}
