import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Wraps protected routes: renders children if authenticated,
 * otherwise redirects to /login, preserving the intended destination.
 */
export function PrivateRoute() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
