import { animationClasses } from '../../lib/animations';

type AppLoadingStateProps = {
  title?: string;
  description?: string;
  compact?: boolean;
};

export function AppLoadingState({
  title = 'Загружаем раздел',
  description = 'Получаем данные и готовим интерфейс.',
  compact = false,
}: AppLoadingStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className={compact ? 'w-full max-w-sm' : 'w-full max-w-md'}>
        <div className={`rounded-lg border border-border bg-card/90 px-6 py-7 ${animationClasses.section}`} role="status" aria-live="polite">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="app-skeleton-layout mt-6" aria-hidden="true">
            <div className="app-skeleton h-3 w-28" />
            <div className="app-skeleton mt-3 h-8 w-44" />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="app-skeleton h-20" />
              <div className="app-skeleton h-20" />
            </div>
            <div className="app-skeleton mt-3 h-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
