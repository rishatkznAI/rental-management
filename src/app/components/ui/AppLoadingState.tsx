import { Loader2 } from 'lucide-react';

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
        <div className="rounded-2xl border border-border bg-card/80 px-6 py-8 text-center shadow-sm backdrop-blur">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="mt-6 space-y-3">
            <div className="mx-auto h-2 w-56 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
            <div className="mx-auto grid max-w-xs grid-cols-3 gap-2">
              <div className="h-2 rounded-full bg-muted" />
              <div className="h-2 rounded-full bg-muted/70" />
              <div className="h-2 rounded-full bg-muted/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
