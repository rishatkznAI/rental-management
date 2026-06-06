import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useNavigation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CalendarDays, ChevronDown, LayoutDashboard, LogOut, Menu, Moon, Plus, Settings, Sun, Truck, FileText, Wrench, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { NotificationCenter } from './NotificationCenter';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermissions, pathToSection, pathToRequiredAction } from '../../lib/permissions';
import { traceAuth } from '../../lib/authDebug';
import { AppLoadingState } from '../ui/AppLoadingState';
import { AppErrorState } from '../ui/AppErrorState';
import { LiftLogo } from './LiftLogo';
import { animatedPageClassName, isDemoPresentationMotionEnabled } from '../../lib/animations';

const SIDEBAR_STATE_STORAGE_KEY = 'rental-management:desktop-sidebar-state';

const BOTTOM_NAV = [
  { name: 'Дашборд', href: '/', icon: LayoutDashboard },
  { name: 'Техника', href: '/equipment', icon: Truck },
  { name: 'Аренды', href: '/rentals', icon: FileText },
  { name: 'Сервис', href: '/service', icon: Wrench },
  { name: 'Клиенты', href: '/clients', icon: Users },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY) === 'collapsed';
  });
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [demoPresentationMotion, setDemoPresentationMotion] = useState(false);

  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { can, canView, defaultPath } = usePermissions();
  const firstAllowedPath = defaultPath();
  const hasAccessibleSection = firstAllowedPath !== '/login';
  const visibleBottomNav = BOTTOM_NAV.filter(item => canView(pathToSection(item.href) || 'dashboard'));
  const section = useMemo(() => pathToSection(location.pathname), [location.pathname]);
  const requiredAction = useMemo(() => pathToRequiredAction(location.pathname), [location.pathname]);
  const shouldRedirectBySection = Boolean(section && !canView(section));
  const shouldRedirectByAction = Boolean(
    requiredAction && !can(requiredAction.action, requiredAction.section),
  );
  const primaryCreatePath = useMemo(() => {
    if (can('create', 'rentals')) return '/rentals/new';
    if (can('create', 'service')) return '/service/new';
    if (can('create', 'equipment')) return '/equipment/new';
    if (can('create', 'clients')) return '/clients/new';
    return null;
  }, [can]);
  const canOpenPlanner = canView('planner');
  const desktopSidebarOffsetClass = desktopSidebarCollapsed ? 'sm:left-20' : 'sm:left-64';
  const desktopSidebarMarginClass = desktopSidebarCollapsed ? 'sm:ml-20' : 'sm:ml-64';
  const pageTitle = useMemo(() => {
    if (location.pathname === '/') return 'Дашборд';
    const segment = location.pathname.split('/').filter(Boolean)[0] || '';
    const map: Record<string, string> = {
      tasks: 'Центр задач',
      equipment: 'Техника',
      gsm: 'GSM',
      'knowledge-base': 'База знаний',
      sales: 'Продажи',
      deliveries: 'Доставка',
      rentals: 'Аренды',
      planner: 'Планировщик',
      service: 'Сервис',
      'service-vehicles': 'Служебные машины',
      clients: 'Клиенты',
      documents: 'Документы',
      payments: 'Платежи',
      finance: 'Финансы',
      payroll: 'Зарплата',
      bots: 'Бот',
      reports: 'Отчёты',
      settings: 'Личные настройки',
      admin: 'Панель администратора',
    };
    return map[segment] || 'Скайтех';
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    setProfileOpen(false);
    navigate('/login', { replace: true });
  };

  const handleOpenProfileSettings = () => {
    setProfileOpen(false);
    navigate('/settings');
  };

  const handleToggleDesktopSidebar = () => {
    setDesktopSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  const themeToggleLabel = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const renderThemeToggleButton = () => (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={theme === 'dark'}
      aria-label={themeToggleLabel}
      title={themeToggleLabel}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:bg-input/30 dark:text-primary dark:hover:bg-accent/50"
    >
      <ThemeIcon className="h-5 w-5" />
    </button>
  );

  useEffect(() => {
    const enabled = isDemoPresentationMotionEnabled(location.search);
    setDemoPresentationMotion(enabled);
    document.documentElement.dataset.demoPresentationMotion = String(enabled);
    document.body.classList.toggle('app-demo-presentation-motion', enabled);
    return () => {
      document.documentElement.removeAttribute('data-demo-presentation-motion');
      document.body.classList.remove('app-demo-presentation-motion');
    };
  }, [location.search]);

  // Auth + permission guard via useEffect — avoids render-time <Navigate> which
  // conflicts with React 18 concurrent rendering and breaks Outlet updates.
  useEffect(() => {
    traceAuth('Layout guard evaluated', {
      path: location.pathname,
      isLoading,
      isAuthenticated,
      hasUser: Boolean(user),
      role: user?.role,
      rawRole: user?.rawRole,
      normalizedRole: user?.normalizedRole,
      firstAllowedPath,
      hasAccessibleSection,
      section,
      shouldRedirectBySection,
      shouldRedirectByAction,
    });
    if (isLoading) return;

    if (!isAuthenticated) {
      traceAuth('Layout redirect to /login', {
        reason: 'not authenticated',
        path: location.pathname,
        isLoading,
        isAuthenticated,
        hasUser: Boolean(user),
        role: user?.role,
        rawRole: user?.rawRole,
        normalizedRole: user?.normalizedRole,
        firstAllowedPath,
        hasAccessibleSection,
      }, { stack: true });
      navigate('/login', { replace: true });
      return;
    }

    if (shouldRedirectBySection && hasAccessibleSection) {
      traceAuth('Layout redirect to first allowed route', {
        from: location.pathname,
        to: firstAllowedPath,
        section,
        role: user?.role,
        rawRole: user?.rawRole,
        normalizedRole: user?.normalizedRole,
      });
      navigate(firstAllowedPath, { replace: true });
      return;
    }

    if (requiredAction && shouldRedirectByAction) {
      traceAuth('Layout redirect by action permission', {
        from: location.pathname,
        to: `/${requiredAction.section}`,
        section: requiredAction.section,
        action: requiredAction.action,
        role: user?.role,
        rawRole: user?.rawRole,
        normalizedRole: user?.normalizedRole,
      });
      navigate(`/${requiredAction.section}`, { replace: true });
      return;
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAllowedPath, hasAccessibleSection, isAuthenticated, isLoading, location.pathname, navigate, requiredAction, section, shouldRedirectByAction, shouldRedirectBySection, user]);

  // While checking auth, show the same calm loading state as route transitions.
  if (isLoading) {
    return (
      <AppLoadingState
        title="Проверяем доступ"
        description="Подготавливаем рабочее пространство."
      />
    );
  }
  // Not authenticated yet — useEffect will redirect; render nothing in the meantime
  if (!isAuthenticated) return null;
  if (!hasAccessibleSection) {
    return (
      <AppErrorState
        title="Нет доступных разделов"
        description="Сессия активна, но для этой роли не настроен доступ ни к одному разделу. Обратитесь к администратору."
        onReload={() => window.location.reload()}
      />
    );
  }
  // Do not mount a forbidden screen even for one render tick.
  if (shouldRedirectBySection || shouldRedirectByAction) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        desktopCollapsed={desktopSidebarCollapsed}
        onToggleDesktopCollapse={handleToggleDesktopSidebar}
      />

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
          <LiftLogo className="h-8 w-8" />
          <span className="app-shell-title text-base font-extrabold text-sidebar-foreground">Скайтех</span>
        </div>
        <div className="flex items-center gap-2">
          {renderThemeToggleButton()}
          <NotificationCenter />
          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#2563eb,#6366f1)] text-sm font-bold text-white"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label="Профиль пользователя"
            >
              {user?.profilePhoto ? (
                <img src={user.profilePhoto} alt={user.name} className="h-full w-full object-cover" />
              ) : (
                user ? getInitials(user.name) : '?'
              )}
            </button>
            {profileOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-[0_24px_70px_-38px_rgba(15,23,42,0.55)]"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold text-foreground">{user?.name ?? '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.role ?? 'Пользователь'}</p>
                </div>
                {canView('profile_settings') ? (
                  <button
                    type="button"
                    onClick={handleOpenProfileSettings}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    role="menuitem"
                  >
                    <Settings className="h-4 w-4" />
                    Настройки
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" />
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Desktop top bar */}
      <header className={cn(
        'fixed right-0 top-0 z-20 hidden h-16 items-center justify-between border-b border-border/80 bg-white/88 px-6 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)] backdrop-blur-xl transition-[left] duration-300 dark:bg-background/80 sm:flex',
        desktopSidebarOffsetClass,
      )}>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Рабочее пространство</p>
          <div className="app-shell-title truncate text-lg font-extrabold text-foreground">{pageTitle}</div>
        </div>

        <div className="flex items-center gap-3">
          {primaryCreatePath ? (
            <button
              type="button"
              onClick={() => navigate(primaryCreatePath)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-[0_12px_30px_-26px_rgba(37,99,235,0.75)] transition hover:border-blue-300 hover:bg-blue-50 dark:border-border dark:bg-input/30 dark:text-primary dark:hover:bg-accent/50"
              aria-label="Создать"
              title="Создать"
            >
              <Plus className="h-5 w-5" />
            </button>
          ) : null}
          {canOpenPlanner ? (
            <button
              type="button"
              onClick={() => navigate('/planner')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:bg-input/30 dark:hover:bg-accent/50"
              aria-label="Планировщик"
              title="Планировщик"
            >
              <CalendarDays className="h-5 w-5" />
            </button>
          ) : null}
          {renderThemeToggleButton()}
          <NotificationCenter />
          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((value) => !value)}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-left shadow-[0_14px_36px_-30px_rgba(15,23,42,0.5)] transition hover:border-primary/35 hover:bg-accent/45 dark:hover:bg-accent/50"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#2563eb,#6366f1)] text-sm font-bold text-white">
                {user?.profilePhoto ? (
                  <img src={user.profilePhoto} alt={user.name} className="h-full w-full object-cover" />
                ) : (
                  user ? getInitials(user.name) : '?'
                )}
              </span>
              <span className="min-w-0">
                <span className="block max-w-44 truncate text-sm font-semibold text-foreground">{user?.name ?? '—'}</span>
                <span className="block max-w-44 truncate text-xs text-muted-foreground">{user?.role ?? 'Пользователь'}</span>
              </span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', profileOpen && 'rotate-180')} />
            </button>

            {profileOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-[0_24px_70px_-38px_rgba(15,23,42,0.55)]"
              >
                {canView('profile_settings') ? (
                  <button
                    type="button"
                    onClick={handleOpenProfileSettings}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    role="menuitem"
                  >
                    <Settings className="h-4 w-4" />
                    Настройки
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" />
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={cn(
        'min-h-screen',
        'transition-[margin] duration-300',
        desktopSidebarMarginClass,
        'pt-14 pb-16 sm:pt-16 sm:pb-0',
        'relative',
        demoPresentationMotion && 'app-demo-presentation-motion',
      )}>
        <div key={location.pathname} className={animatedPageClassName()}>
          <Outlet />
        </div>
        {navigation.state !== 'idle' && (
          <div className={cn(
            'pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm transition-[left] duration-300',
            desktopSidebarOffsetClass,
          )}>
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card/95 px-6 py-7 text-center shadow-xl">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">Загружаем раздел</p>
                <p className="text-sm text-muted-foreground">Получаем свежие данные. Это займёт несколько секунд.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border/80 bg-sidebar/95 backdrop-blur-xl sm:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${Math.max(visibleBottomNav.length, 1)}, minmax(0, 1fr))` }}
        >
          {visibleBottomNav.map((item) => {
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
