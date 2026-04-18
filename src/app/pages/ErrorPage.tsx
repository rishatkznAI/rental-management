import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router-dom';
import { AppErrorState } from '../components/ui/AppErrorState';

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
    <AppErrorState
      title={title}
      description={description}
      onBack={() => navigate(-1)}
      onReload={() => window.location.reload()}
    />
  );
}
