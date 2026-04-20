import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { LayoutDashboard, Truck, FileText, Wrench, Users, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { NotificationCenter } from './NotificationCenter';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, pathToSection, pathToRequiredAction } from '../../lib/permissions';

const BOTTOM_NAV = [
  { name: 'Дашборд', href: '/', icon: LayoutDashboard },
  { name: 'Техника', href: '/equipment', icon: Truck },
  { name: 'Аренды', href: '/rentals', icon: FileText },
  { name: 'Сервис', href: '/service', icon: Wrench },
  { name: 'Клиенты', href: '/clients', icon: Users },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { isAuthenticated, isLoading } = useAuth();
  const { can, canView, defaultPath } = usePermissions();
  const section = pathToSection(location.pathname);
  const requiredAction = pathToRequiredAction(location.pathname);
  const shouldRedirectBySection = Boolean(section && !canView(section));
  const shouldRedirectByAction = Boolean(
    requiredAction && !can(requiredAction.action, requiredAction.section),
  );

  // Auth + permission guard via useEffect — avoids render-time <Navigate> which
  // conflicts with React 18 concurrent rendering and breaks Outlet updates.
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    if (shouldRedirectBySection) {
      navigate(defaultPath(), { replace: true });
      return;
    }

    if (requiredAction && shouldRedirectByAction) {
      navigate(`/${requiredAction.section}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPath, isAuthenticated, isLoading, location.pathname, navigate, requiredAction, shouldRedirectByAction, shouldRedirectBySection]);

  // While checking auth — render nothing
  if (isLoading) return null;
  // Not authenticated yet — useEffect will redirect; render nothing in the meantime
  if (!isAuthenticated) return null;
  // Do not mount a forbidden screen even for one render tick.
  if (shouldRedirectBySection || shouldRedirectByAction) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile top bar */}
      <header className="fixed top-0 left-0 right-0 z-20 flex h-14 items-center justify-between border-b border-border/80 bg-sidebar/95 px-4 backdrop-blur-xl sm:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-lg p-2 transition-colors hover:bg-accent"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5 text-sidebar-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          <span className="app-shell-title text-base font-extrabold text-sidebar-foreground">Подъёмники</span>
        </div>
        <NotificationCenter />
      </header>

      {/* Main content */}
      <main className={cn(
        'min-h-screen',
        'sm:ml-64',
        'pt-14 pb-16 sm:pt-0 sm:pb-0',
        'relative',
      )}>
        <Outlet key={location.pathname} />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border/80 bg-sidebar/95 backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-5">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => navigate(item.href)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-primary')} />
                <span className="leading-none">{item.name}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
