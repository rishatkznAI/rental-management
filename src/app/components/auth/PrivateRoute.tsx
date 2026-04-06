import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, pathToSection } from '../../lib/permissions';

/**
 * Оборачивает защищённые маршруты:
 * 1. Если пользователь не авторизован — редирект на /login.
 * 2. Если URL не разрешён ролью — редирект на первый доступный раздел.
 */
export function PrivateRoute() {
  const { isAuthenticated } = useAuth();
  const { canView, defaultPath } = usePermissions();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Проверяем, есть ли у роли доступ к текущему разделу
  const section = pathToSection(location.pathname);
  if (section && !canView(section)) {
    return <Navigate to={defaultPath()} replace />;
  }

  return <Outlet />;
}
