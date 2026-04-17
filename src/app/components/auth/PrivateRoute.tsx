import { Navigate, Outlet, useLocation } from 'react-router/dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, pathToSection, pathToRequiredAction } from '../../lib/permissions';

/**
 * Оборачивает защищённые маршруты:
 * 1. Пока сессия проверяется (/api/auth/me) — показываем пустой экран.
 * 2. Если пользователь не авторизован — редирект на /login.
 * 3. Если URL не разрешён ролью (view-уровень) — редирект на первый доступный раздел.
 * 4. Если маршрут требует action-уровня (create) и роль его не имеет — редирект назад.
 */
export function PrivateRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const { can, canView, defaultPath } = usePermissions();
  const location = useLocation();

  // Ждём пока AuthProvider проверит сохранённый токен через /api/auth/me
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Проверяем view-доступ к разделу
  const section = pathToSection(location.pathname);
  if (section && !canView(section)) {
    return <Navigate to={defaultPath()} replace />;
  }

  // Проверяем action-уровень для create-маршрутов (/*/new)
  const required = pathToRequiredAction(location.pathname);
  if (required && !can(required.action, required.section)) {
    return <Navigate to={`/${required.section}`} replace />;
  }

  return <Outlet />;
}
