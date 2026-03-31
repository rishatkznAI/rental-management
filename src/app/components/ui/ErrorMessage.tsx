import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './button';

interface ErrorMessageProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorMessage({
  title = 'Ошибка загрузки данных',
  message = 'Что-то пошло не так. Попробуйте ещё раз.',
  onRetry,
}: ErrorMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <div className="space-y-1">
        <p className="font-semibold text-lg">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Повторить
        </Button>
      )}
    </div>
  );
}
