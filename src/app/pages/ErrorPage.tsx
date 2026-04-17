import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router/dom';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';

export default function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = 'Что-то пошло не так';
  let description = 'Произошла непредвиденная ошибка. Попробуйте обновить страницу или вернуться назад.';

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Страница не найдена';
      description = 'Запрашиваемая страница не существует или была удалена.';
    } else if (error.status === 403) {
      title = 'Нет доступа';
      description = 'У вас нет прав для просмотра этой страницы.';
    } else if (error.status >= 500) {
      title = 'Ошибка сервера';
      description = 'Сервер временно недоступен. Попробуйте позже.';
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-5">
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться
          </Button>
          <Button
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
        </div>
      </div>
    </div>
  );
}
