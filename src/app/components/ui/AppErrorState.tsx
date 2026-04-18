import type { ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from './button';

type AppErrorStateProps = {
  title: string;
  description: string;
  onBack?: () => void;
  onReload?: () => void;
  extraAction?: ReactNode;
};

export function AppErrorState({
  title,
  description,
  onBack,
  onReload,
  extraAction,
}: AppErrorStateProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card/80 px-6 py-8 text-center shadow-sm backdrop-blur">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-10 w-10 text-destructive" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {onBack && (
            <Button variant="outline" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Вернуться
            </Button>
          )}
          {onReload && (
            <Button onClick={onReload} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Обновить
            </Button>
          )}
          {extraAction}
        </div>
      </div>
    </div>
  );
}
